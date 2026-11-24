-- Keep retry history useful for diagnosis without recording exception values,
-- which may contain patient or invoice data.
ALTER TABLE mis_internal.mis_gateway_events
  ADD COLUMN IF NOT EXISTS detail text;

CREATE OR REPLACE FUNCTION mis_internal.mis_gateway_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mis_internal, public, extensions
AS $$
DECLARE
  j mis_internal.mis_gateway_jobs%rowtype;
  r jsonb;
  pub mis_internal.mis_gateway_publication%rowtype;
  target bigint;
  snap record;
  n integer := 0;
  err text;
  err_context text;
  safe_detail text;
  retryable boolean;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE='42501';
  END IF;

  IF NOT mis_internal.is_overnight() AND NOT (
    EXISTS (
      SELECT 1 FROM mis_internal.mis_gateway_publication
      WHERE stage <> 'complete' AND target_batch_id > 0
    )
    AND NOT EXISTS (
      SELECT 1 FROM mis_internal.mis_gateway_jobs
      WHERE status IN ('pending','failed')
    )
  ) THEN
    RETURN jsonb_build_object('status','outside_overnight_window');
  END IF;

  IF NOT pg_try_advisory_xact_lock(806731,7001)
     OR NOT pg_try_advisory_xact_lock(806731,7100) THEN
    RETURN jsonb_build_object('status','busy');
  END IF;
  FOREACH n IN ARRAY ARRAY[7002,7003,7010,7020,7030,7031] LOOP
    IF NOT pg_try_advisory_xact_lock(806731,n) THEN
      RETURN jsonb_build_object('status','busy');
    END IF;
  END LOOP;

  -- Do not process or publish a partially queued batch.
  IF EXISTS (
    SELECT 1 FROM mis_internal.mis_gateway_enqueue_progress WHERE phase='queue'
  ) THEN
    RETURN jsonb_build_object('status','awaiting_enqueue');
  END IF;

  UPDATE mis_internal.mis_gateway_jobs older
  SET status='superseded', completed_at=now()
  WHERE status IN ('pending','failed')
    AND EXISTS (
      SELECT 1 FROM mis_internal.mis_gateway_jobs newer
      WHERE newer.invoice_key=older.invoice_key
        AND newer.batch_id>older.batch_id AND newer.status='completed'
    );

  SELECT * INTO j
  FROM mis_internal.mis_gateway_jobs
  WHERE status='pending' AND next_attempt_at<=now()
  ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1;

  IF FOUND THEN
    BEGIN
      r := mis_internal.apply_gateway_invoice(j.id);
      INSERT INTO mis_internal.mis_gateway_events(job_id,event)
      VALUES(j.id,r->>'status');
      RETURN r || jsonb_build_object('jobId',j.id);
    EXCEPTION WHEN query_canceled OR OTHERS THEN
      GET STACKED DIAGNOSTICS
        err=RETURNED_SQLSTATE,
        err_context=PG_EXCEPTION_CONTEXT;

      -- Retriable database conditions only. Type, constraint, and validation
      -- errors should be reviewed instead of replayed five times.
      retryable := err IN (
        '57014', -- query canceled / statement timeout
        '55P03', -- lock not available
        '40001', -- serialization failure
        '40P01', -- deadlock
        '53300', -- too many connections
        '57P01', -- admin shutdown
        '57P02', -- crash shutdown
        '57P03'  -- cannot connect now
      ) OR left(err,2)='08'; -- connection exception class

      SELECT left(line,240) INTO safe_detail
      FROM unnest(string_to_array(COALESCE(err_context,''), E'\n')) AS ctx(line)
      WHERE line LIKE 'PL/pgSQL function %'
      LIMIT 1;

      INSERT INTO mis_internal.mis_gateway_events(job_id,event,code,detail)
      VALUES(j.id,CASE WHEN retryable THEN 'attempt_retryable' ELSE 'attempt_terminal' END,err,safe_detail);

      UPDATE mis_internal.mis_gateway_jobs
      SET attempts=attempts+1,
          error_code=err,
          status=CASE WHEN retryable AND attempts<4 THEN 'pending' ELSE 'failed' END,
          completed_at=CASE WHEN retryable AND attempts<4 THEN NULL ELSE now() END,
          next_attempt_at=CASE
            WHEN retryable AND attempts<4
              THEN now()+make_interval(secs=>least(900,30*(2^attempts)::integer))
            ELSE next_attempt_at
          END,
          result=jsonb_build_object('errorStage','apply_gateway_invoice','errorCode',err)
      WHERE id=j.id;

      RETURN jsonb_build_object(
        'status',CASE WHEN retryable AND j.attempts<4 THEN 'retry' ELSE 'failed' END,
        'jobId',j.id,'code',err,'retryable',retryable
      );
    END;
  END IF;

  IF EXISTS (
    SELECT 1 FROM mis_internal.mis_gateway_jobs WHERE status IN ('pending','failed')
  ) THEN
    RETURN jsonb_build_object('status','awaiting_jobs');
  END IF;

  SELECT max(id) INTO target FROM mis_internal.mis_gateway_batches;
  SELECT * INTO pub FROM mis_internal.mis_gateway_publication
  WHERE singleton FOR UPDATE;
  IF target IS NULL OR (pub.stage='complete' AND pub.published_batch_id>=target) THEN
    RETURN jsonb_build_object('status','idle');
  END IF;
  IF pub.target_batch_id<>target THEN
    UPDATE mis_internal.mis_gateway_publication
    SET target_batch_id=target,stage='finance',snapshot_after=''
    WHERE singleton RETURNING * INTO pub;
  END IF;

  PERFORM set_config('app.mis_worker','on',true);
  PERFORM set_config('app.mis_gateway_publish','on',true);
  BEGIN
    IF pub.stage='finance' THEN
      r := public.refresh_finance_derived_data();
      UPDATE mis_internal.mis_gateway_publication SET stage='snapshots' WHERE singleton;
    ELSIF pub.stage='snapshots' THEN
      n := 0;
      FOR snap IN
        SELECT snapshot_key,start_date,end_date
        FROM public.dashboard_metric_snapshots
        WHERE snapshot_key>pub.snapshot_after
        ORDER BY snapshot_key LIMIT 5
      LOOP
        PERFORM public.refresh_dashboard_metric_snapshot_cron(snap.start_date,snap.end_date);
        UPDATE mis_internal.mis_gateway_publication
        SET snapshot_after=snap.snapshot_key WHERE singleton;
        n := n+1;
      END LOOP;
      r := jsonb_build_object('status','completed','snapshots',n);
      IF n<5 THEN
        UPDATE mis_internal.mis_gateway_publication
        SET stage='complete',published_batch_id=target WHERE singleton;
      END IF;
    END IF;
    UPDATE mis_internal.mis_gateway_publication
    SET last_result=r-'error',updated_at=now() WHERE singleton;
    RETURN jsonb_build_object(
      'status',CASE WHEN COALESCE(r->>'status','completed') IN ('completed','step_completed')
        THEN 'advanced' ELSE 'deferred' END,
      'stage',pub.stage
    );
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    GET STACKED DIAGNOSTICS err=RETURNED_SQLSTATE,err_context=PG_EXCEPTION_CONTEXT;
    UPDATE mis_internal.mis_gateway_publication
    SET last_result=jsonb_build_object('status','failed','code',err,'context',err_context),
        updated_at=now()
    WHERE singleton;
    RETURN jsonb_build_object('status','deferred','stage',pub.stage,'code',err);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION mis_internal.mis_gateway_status(p_actor_id uuid,p_upload_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mis_internal, public, extensions
AS $$
DECLARE r jsonb;
BEGIN
  PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);
  SELECT jsonb_build_object(
    'batchId',b.id,
    'acceptedAt',b.accepted_at,
    'authority',b.authority,
    'invoices',count(j.id),
    'completed',count(*) FILTER(WHERE j.status='completed'),
    'superseded',count(*) FILTER(WHERE j.status='superseded'),
    'failed',count(*) FILTER(WHERE j.status='failed'),
    'pending',count(*) FILTER(WHERE j.status='pending'),
    'attempts',COALESCE(sum(j.attempts),0),
    'published',pub.stage='complete' AND pub.published_batch_id>=b.id,
    'publicationStage',pub.stage,
    'publicationResult',pub.last_result,
    'errorCodes',COALESCE(jsonb_agg(DISTINCT j.error_code) FILTER(WHERE j.error_code IS NOT NULL),'[]'::jsonb),
    'errors',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'invoiceKey',x.invoice_key,
        'status',x.status,
        'attempts',x.attempts,
        'code',x.error_code,
        'detail',ev.detail,
        'occurredAt',ev.occurred_at
      ) ORDER BY x.id DESC)
      FROM (
        SELECT q.id,q.invoice_key,q.status,q.attempts,q.error_code
        FROM mis_internal.mis_gateway_jobs q
        WHERE q.batch_id=b.id AND q.error_code IS NOT NULL
        ORDER BY q.id DESC LIMIT 25
      ) x
      LEFT JOIN LATERAL (
        SELECT e.detail,e.occurred_at
        FROM mis_internal.mis_gateway_events e
        WHERE e.job_id=x.id AND e.event IN ('attempt_retryable','attempt_terminal','attempt_failed')
        ORDER BY e.id DESC LIMIT 1
      ) ev ON true
    ),'[]'::jsonb)
  ) INTO r
  FROM mis_internal.mis_gateway_batches b
  JOIN mis_internal.mis_upload_parses p ON p.id=b.parse_id
  JOIN mis_internal.mis_gateway_jobs j ON j.batch_id=b.id
  CROSS JOIN mis_internal.mis_gateway_publication pub
  WHERE p.upload_id=p_upload_id
  GROUP BY b.id,pub.published_batch_id,pub.stage,pub.last_result
  ORDER BY b.id DESC LIMIT 1;
  RETURN r;
END;
$$;

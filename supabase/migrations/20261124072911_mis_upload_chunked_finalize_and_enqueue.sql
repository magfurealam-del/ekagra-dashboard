-- Keep large MIS source uploads below PostgREST's statement timeout. The source
-- rows are staged in small batches; final integrity now uses the indexed row
-- number range, while invoice validation and enqueueing advance in bounded
-- durable chunks.

CREATE TABLE mis_internal.mis_gateway_enqueue_progress (
  parse_id uuid PRIMARY KEY REFERENCES mis_internal.mis_upload_parses(id) ON DELETE RESTRICT,
  batch_id bigint REFERENCES mis_internal.mis_gateway_batches(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  phase text NOT NULL DEFAULT 'validate' CHECK (phase IN ('validate', 'queue', 'complete', 'rejected')),
  cursor_invoice_key text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

REVOKE ALL ON mis_internal.mis_gateway_enqueue_progress FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE mis_internal.mis_upload_chunk_verifications (
  parse_id uuid NOT NULL REFERENCES mis_internal.mis_upload_parses(id) ON DELETE RESTRICT,
  start_row_number integer NOT NULL CHECK (start_row_number > 0),
  end_row_number integer NOT NULL CHECK (end_row_number >= start_row_number),
  row_count integer NOT NULL CHECK (row_count = end_row_number - start_row_number + 1),
  chunk_sha256 text NOT NULL CHECK (chunk_sha256 ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (parse_id, start_row_number)
);

REVOKE ALL ON mis_internal.mis_upload_chunk_verifications FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION mis_internal.stage_mis_upload_rows_checked(
  p_actor_id uuid,
  p_attempt_id uuid,
  p_parse_id uuid,
  p_rows jsonb,
  p_expected_chunk_sha256 text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row_count integer;
  v_start_row integer;
  v_end_row integer;
  v_staged_count integer;
  v_staged_start integer;
  v_staged_end integer;
  v_actual_sha text;
  v_existing mis_internal.mis_upload_chunk_verifications%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) < 1
     OR jsonb_array_length(p_rows) > 250
     OR p_expected_chunk_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid checked staging batch' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer,
         min((x.value ->> 'sourceRowNumber')::integer),
         max((x.value ->> 'sourceRowNumber')::integer)
    INTO v_row_count, v_start_row, v_end_row
    FROM jsonb_array_elements(p_rows) AS x(value);
  IF v_row_count <> jsonb_array_length(p_rows)
     OR v_end_row - v_start_row + 1 <> v_row_count THEN
    RAISE EXCEPTION 'staging batch row numbers must be contiguous' USING ERRCODE = '22023';
  END IF;

  PERFORM mis_internal.stage_mis_upload_rows(p_actor_id, p_attempt_id, p_parse_id, p_rows);

  SELECT count(*)::integer, min(r.source_row_number), max(r.source_row_number),
         encode(extensions.digest(convert_to(COALESCE(string_agg(
           r.source_row_number::text || ':' || r.row_sha256 || E'\n', ''
           ORDER BY r.source_row_number
         ), ''), 'UTF8'), 'sha256'), 'hex')
    INTO v_staged_count, v_staged_start, v_staged_end, v_actual_sha
    FROM mis_internal.mis_upload_rows r
   WHERE r.parse_id = p_parse_id
     AND r.source_row_number BETWEEN v_start_row AND v_end_row;

  IF v_staged_count <> v_row_count OR v_staged_start <> v_start_row
     OR v_staged_end <> v_end_row OR v_actual_sha <> p_expected_chunk_sha256 THEN
    RAISE EXCEPTION 'staged chunk digest mismatch' USING ERRCODE = '22000';
  END IF;

  INSERT INTO mis_internal.mis_upload_chunk_verifications(
    parse_id, start_row_number, end_row_number, row_count, chunk_sha256
  ) VALUES (p_parse_id, v_start_row, v_end_row, v_row_count, v_actual_sha)
  ON CONFLICT (parse_id, start_row_number) DO NOTHING;

  SELECT * INTO v_existing
    FROM mis_internal.mis_upload_chunk_verifications
   WHERE parse_id = p_parse_id AND start_row_number = v_start_row;
  IF v_existing.end_row_number <> v_end_row OR v_existing.row_count <> v_row_count
     OR v_existing.chunk_sha256 <> v_actual_sha THEN
    RAISE EXCEPTION 'staged chunk replay digest mismatch' USING ERRCODE = '22000';
  END IF;
  RETURN v_row_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stage_mis_upload_rows_checked(
  p_actor_id uuid,
  p_attempt_id uuid,
  p_parse_id uuid,
  p_rows jsonb,
  p_expected_chunk_sha256 text
)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT mis_internal.stage_mis_upload_rows_checked(
    p_actor_id, p_attempt_id, p_parse_id, p_rows, p_expected_chunk_sha256
  )
$function$;

REVOKE ALL ON FUNCTION mis_internal.stage_mis_upload_rows_checked(uuid, uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.stage_mis_upload_rows_checked(uuid, uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mis_internal.stage_mis_upload_rows_checked(uuid, uuid, uuid, jsonb, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.stage_mis_upload_rows_checked(uuid, uuid, uuid, jsonb, text)
  TO service_role;

CREATE OR REPLACE FUNCTION mis_internal.seal_mis_upload_parse(
  p_actor_id uuid,
  p_attempt_id uuid,
  p_parse_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_parse mis_internal.mis_upload_parses%ROWTYPE;
  v_upload_id uuid;
  v_row_count integer;
  v_min_row_number integer;
  v_max_row_number integer;
  v_chunk_count integer;
  v_chunk_rows integer;
  v_chunk_min integer;
  v_chunk_max integer;
  v_chunks_contiguous boolean;
  v_validation_count integer;
  v_state text;
BEGIN
  PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);

  SELECT f.id INTO v_upload_id
    FROM mis_internal.mis_upload_attempts a
    JOIN mis_internal.mis_upload_attempt_events e ON e.attempt_id = a.id
    JOIN mis_internal.mis_upload_files f ON f.id = (e.details ->> 'upload_id')::uuid
   WHERE a.id = p_attempt_id AND a.actor_id = p_actor_id AND e.event_type = 'uploaded'
   ORDER BY e.occurred_at DESC
   LIMIT 1;

  SELECT p.* INTO v_parse FROM mis_internal.mis_upload_parses p
   WHERE p.id = p_parse_id AND p.upload_id = v_upload_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parse not found for upload attempt' USING ERRCODE = 'P0002';
  END IF;

  IF v_parse.status = 'sealed' THEN
    SELECT s.state INTO v_state FROM mis_internal.mis_upload_state s
     WHERE s.upload_id = v_parse.upload_id;
    RETURN jsonb_build_object(
      'uploadId', v_parse.upload_id, 'parseId', p_parse_id,
      'state', v_state, 'sourceRowCount', v_parse.source_row_count
    );
  END IF;

  -- Every 250-row staging batch was digest-checked before a receipt was saved.
  -- The primary key guarantees unique row numbers; these bounded receipts prove
  -- the checks cover the full range without one large whole-file aggregation.
  SELECT count(*)::integer, min(r.source_row_number), max(r.source_row_number)
    INTO v_row_count, v_min_row_number, v_max_row_number
    FROM mis_internal.mis_upload_rows r
   WHERE r.parse_id = p_parse_id;

  WITH ordered_chunks AS (
    SELECT c.start_row_number, c.end_row_number, c.row_count,
           lag(c.end_row_number) OVER (ORDER BY c.start_row_number) AS previous_end
      FROM mis_internal.mis_upload_chunk_verifications c
     WHERE c.parse_id = p_parse_id
  )
  SELECT count(*)::integer, COALESCE(sum(c.row_count), 0)::integer,
         min(c.start_row_number), max(c.end_row_number),
         COALESCE(bool_and(c.start_row_number = COALESCE(c.previous_end, 0) + 1), true)
    INTO v_chunk_count, v_chunk_rows, v_chunk_min, v_chunk_max, v_chunks_contiguous
    FROM ordered_chunks c;

  IF v_row_count <> v_parse.source_row_count
     OR v_chunk_rows <> v_parse.source_row_count
     OR v_chunk_count <> ceil(v_parse.source_row_count / 250.0)::integer
     OR (v_parse.source_row_count > 0 AND
         (v_min_row_number <> 1 OR v_max_row_number <> v_parse.source_row_count
          OR v_chunk_min <> 1 OR v_chunk_max <> v_parse.source_row_count
          OR NOT v_chunks_contiguous)) THEN
    RAISE EXCEPTION 'staged row count, chunk digest, or row range mismatch' USING ERRCODE = '22000';
  END IF;

  SELECT count(*)::integer INTO v_validation_count
    FROM mis_internal.mis_import_validations v
   WHERE v.parse_id = p_parse_id AND v.outcome IN ('rejected', 'conflict');

  UPDATE mis_internal.mis_upload_parses
     SET status = 'sealed', sealed_at = clock_timestamp()
   WHERE id = p_parse_id;

  v_state := CASE WHEN v_validation_count = 0 THEN 'validated' ELSE 'quarantined' END;
  UPDATE mis_internal.mis_upload_state
     SET state = v_state,
         state_version = state_version + 1,
         active_parse_id = p_parse_id,
         last_error_code = NULL,
         updated_at = clock_timestamp()
   WHERE upload_id = v_parse.upload_id;

  INSERT INTO mis_internal.mis_upload_attempt_events (attempt_id, event_type, details)
  SELECT p_attempt_id,
         CASE WHEN v_validation_count = 0 THEN 'staged' ELSE 'rejected' END,
         jsonb_build_object(
           'upload_id', v_parse.upload_id,
           'parse_id', p_parse_id,
           'source_row_count', v_row_count,
           'validation_count', v_validation_count
         )
   WHERE NOT EXISTS (
     SELECT 1 FROM mis_internal.mis_upload_attempt_events e
      WHERE e.attempt_id = p_attempt_id
        AND e.event_type IN ('staged', 'rejected')
        AND e.details ->> 'parse_id' = p_parse_id::text
   );

  RETURN jsonb_build_object(
    'uploadId', v_parse.upload_id, 'parseId', p_parse_id,
    'state', v_state, 'sourceRowCount', v_row_count,
    'blankRecordCount', v_parse.blank_record_count,
    'validationCount', v_validation_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION mis_internal.complete_mis_upload(
  p_actor_id uuid,
  p_attempt_id uuid,
  p_parse_id uuid,
  p_enqueue boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  sealed jsonb;
BEGIN
  -- Enqueue work is performed separately by enqueue_mis_upload_chunk so this
  -- final integrity transaction stays small and independently retryable.
  sealed := mis_internal.seal_mis_upload_parse(p_actor_id, p_attempt_id, p_parse_id);
  RETURN sealed || jsonb_build_object('pipeline', NULL, 'pipelineError', NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION mis_internal.enqueue_mis_upload_chunk(
  p_actor_id uuid,
  p_upload_id uuid,
  p_chunk_size integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_parse mis_internal.mis_upload_parses%ROWTYPE;
  v_batch_id bigint;
  v_phase text;
  v_cursor text;
  v_invoice_keys text[];
  v_last_key text;
  v_invoice_count integer;
BEGIN
  PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);
  IF p_chunk_size < 1 OR p_chunk_size > 500 THEN
    RAISE EXCEPTION 'enqueue chunk size must be between 1 and 500' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(806731, 7100);

  SELECT x.* INTO v_parse
    FROM mis_internal.mis_upload_state s
    JOIN mis_internal.mis_upload_parses x ON x.id = s.active_parse_id
   WHERE s.upload_id = p_upload_id
     AND s.state IN ('validated', 'staged')
     AND x.status = 'sealed'
   FOR UPDATE OF s;
  IF NOT FOUND OR v_parse.source_row_count = 0 THEN
    RAISE EXCEPTION 'sealed nonempty validated parse required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO mis_internal.mis_gateway_enqueue_progress(parse_id, actor_id)
  VALUES (v_parse.id, p_actor_id)
  ON CONFLICT (parse_id) DO NOTHING;
  SELECT phase, cursor_invoice_key, batch_id INTO v_phase, v_cursor, v_batch_id
    FROM mis_internal.mis_gateway_enqueue_progress
   WHERE parse_id = v_parse.id FOR UPDATE;

  IF v_phase = 'complete' THEN
    SELECT count(*)::integer INTO v_invoice_count
      FROM mis_internal.mis_gateway_jobs WHERE batch_id = v_batch_id;
    RETURN jsonb_build_object('done', true, 'phase', 'complete', 'batchId', v_batch_id,
                              'invoiceCount', v_invoice_count, 'state', 'queued');
  END IF;

  SELECT array_agg(k.invoice_key ORDER BY k.invoice_key) INTO v_invoice_keys
    FROM (
      SELECT lower(btrim(r.normalized_values ->> 'invoice_id')) AS invoice_key
        FROM mis_internal.mis_upload_rows r
       WHERE r.parse_id = v_parse.id
         AND lower(btrim(r.normalized_values ->> 'invoice_id')) > v_cursor
       GROUP BY 1 ORDER BY 1 LIMIT p_chunk_size
    ) k;

  IF v_invoice_keys IS NULL THEN
    IF v_phase = 'validate' THEN
      INSERT INTO mis_internal.mis_gateway_batches(parse_id, actor_id)
      VALUES (v_parse.id, p_actor_id)
      ON CONFLICT (parse_id) DO NOTHING
      RETURNING id INTO v_batch_id;
      IF v_batch_id IS NULL THEN
        SELECT id INTO v_batch_id FROM mis_internal.mis_gateway_batches WHERE parse_id = v_parse.id;
      END IF;
      UPDATE mis_internal.mis_gateway_enqueue_progress
         SET batch_id = v_batch_id, phase = 'queue', cursor_invoice_key = '', updated_at = clock_timestamp()
       WHERE parse_id = v_parse.id;
      RETURN jsonb_build_object('done', false, 'phase', 'queue', 'batchId', v_batch_id,
                                'invoiceCount', 0);
    END IF;
    UPDATE mis_internal.mis_gateway_enqueue_progress
       SET phase = 'complete', updated_at = clock_timestamp()
     WHERE parse_id = v_parse.id;
    SELECT count(*)::integer INTO v_invoice_count
      FROM mis_internal.mis_gateway_jobs WHERE batch_id = v_batch_id;
    RETURN jsonb_build_object('done', true, 'phase', 'complete', 'batchId', v_batch_id,
                              'invoiceCount', v_invoice_count, 'state', 'queued');
  END IF;

  v_last_key := v_invoice_keys[array_length(v_invoice_keys, 1)];
  IF v_phase = 'validate' THEN
    IF EXISTS (
      SELECT 1
        FROM mis_internal.mis_upload_rows r
       WHERE r.parse_id = v_parse.id
         AND lower(btrim(r.normalized_values ->> 'invoice_id')) = ANY(v_invoice_keys)
       GROUP BY lower(btrim(r.normalized_values ->> 'invoice_id'))
      HAVING count(*) > 1000
          OR bool_or(r.disposition <> 'parsed')
          OR count(DISTINCT (r.normalized_values - ARRAY[
            'item_id','item_name','sales_amount','item_discount','net_sales','net_collection',
            'cancellation_amount','parent_item_type_name','item_type_name','business_unit_name',
            'doctors_department','contributor_doctor_name'
          ])) <> 1
    ) THEN
      RAISE EXCEPTION 'invoice has conflicting headers, invalid rows, or exceeds 1000 lines'
        USING ERRCODE = '22023';
    END IF;

    IF cardinality(v_invoice_keys) < p_chunk_size THEN
      INSERT INTO mis_internal.mis_gateway_batches(parse_id, actor_id)
      VALUES (v_parse.id, p_actor_id)
      ON CONFLICT (parse_id) DO NOTHING
      RETURNING id INTO v_batch_id;
      IF v_batch_id IS NULL THEN
        SELECT id INTO v_batch_id FROM mis_internal.mis_gateway_batches WHERE parse_id = v_parse.id;
      END IF;
    END IF;
    UPDATE mis_internal.mis_gateway_enqueue_progress
       SET batch_id = COALESCE(v_batch_id, batch_id),
           phase = CASE WHEN cardinality(v_invoice_keys) < p_chunk_size THEN 'queue' ELSE 'validate' END,
           cursor_invoice_key = CASE WHEN cardinality(v_invoice_keys) < p_chunk_size THEN '' ELSE v_last_key END,
           updated_at = clock_timestamp()
     WHERE parse_id = v_parse.id;
    RETURN jsonb_build_object('done', false, 'phase',
      CASE WHEN cardinality(v_invoice_keys) < p_chunk_size THEN 'queue' ELSE 'validate' END,
      'batchId', v_batch_id, 'checkedInvoices', cardinality(v_invoice_keys));
  END IF;

  INSERT INTO mis_internal.mis_gateway_jobs(batch_id, invoice_key)
  SELECT v_batch_id, invoice_key FROM unnest(v_invoice_keys) AS k(invoice_key)
  ON CONFLICT (batch_id, invoice_key) DO NOTHING;

  UPDATE mis_internal.mis_gateway_enqueue_progress
     SET cursor_invoice_key = v_last_key,
         phase = CASE WHEN cardinality(v_invoice_keys) < p_chunk_size THEN 'complete' ELSE 'queue' END,
         updated_at = clock_timestamp()
   WHERE parse_id = v_parse.id;
  IF cardinality(v_invoice_keys) < p_chunk_size THEN
    SELECT count(*)::integer INTO v_invoice_count
      FROM mis_internal.mis_gateway_jobs WHERE batch_id = v_batch_id;
    RETURN jsonb_build_object('done', true, 'phase', 'complete', 'batchId', v_batch_id,
                              'invoiceCount', v_invoice_count, 'state', 'queued');
  END IF;
  RETURN jsonb_build_object('done', false, 'phase', 'queue', 'batchId', v_batch_id,
                            'queuedInvoices', cardinality(v_invoice_keys));
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_mis_upload_chunk(
  p_actor_id uuid,
  p_upload_id uuid,
  p_chunk_size integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT mis_internal.enqueue_mis_upload_chunk(p_actor_id, p_upload_id, p_chunk_size)
$function$;

REVOKE ALL ON FUNCTION mis_internal.enqueue_mis_upload_chunk(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_mis_upload_chunk(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mis_internal.enqueue_mis_upload_chunk(uuid, uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_mis_upload_chunk(uuid, uuid, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION mis_internal.quarantine_mis_upload_enqueue(
  p_actor_id uuid,
  p_attempt_id uuid,
  p_upload_id uuid,
  p_error_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);
  IF NOT EXISTS (
    SELECT 1 FROM mis_internal.mis_upload_attempts a
     WHERE a.id = p_attempt_id AND a.actor_id = p_actor_id
  ) THEN
    RAISE EXCEPTION 'upload attempt not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE mis_internal.mis_upload_state
     SET state = 'quarantined', state_version = state_version + 1,
         last_error_code = left(p_error_code, 80), updated_at = clock_timestamp()
   WHERE upload_id = p_upload_id;
  UPDATE mis_internal.mis_gateway_enqueue_progress
     SET phase = 'rejected', cursor_invoice_key = '', updated_at = clock_timestamp()
   WHERE parse_id = (SELECT active_parse_id FROM mis_internal.mis_upload_state WHERE upload_id = p_upload_id);
  INSERT INTO mis_internal.mis_upload_attempt_events(attempt_id, event_type, error_code, details)
  VALUES (p_attempt_id, 'rejected', left(p_error_code, 80),
          jsonb_build_object('upload_id', p_upload_id, 'stage', 'enqueue'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.quarantine_mis_upload_enqueue(
  p_actor_id uuid,
  p_attempt_id uuid,
  p_upload_id uuid,
  p_error_code text
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT mis_internal.quarantine_mis_upload_enqueue(p_actor_id, p_attempt_id, p_upload_id, p_error_code)
$function$;

REVOKE ALL ON FUNCTION mis_internal.quarantine_mis_upload_enqueue(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quarantine_mis_upload_enqueue(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mis_internal.quarantine_mis_upload_enqueue(uuid, uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.quarantine_mis_upload_enqueue(uuid, uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION mis_internal.mis_gateway_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mis_internal, public, extensions
AS $$
DECLARE j mis_internal.mis_gateway_jobs%rowtype; r jsonb; pub mis_internal.mis_gateway_publication%rowtype;
 target bigint; snap record; n integer:=0; err text; err_context text;
BEGIN
 IF COALESCE(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 IF NOT mis_internal.is_overnight() AND NOT (
  EXISTS(SELECT 1 FROM mis_internal.mis_gateway_publication WHERE stage<>'complete' AND target_batch_id>0)
  AND NOT EXISTS(SELECT 1 FROM mis_internal.mis_gateway_jobs WHERE status IN ('pending','failed'))
 ) THEN RETURN jsonb_build_object('status','outside_overnight_window'); END IF;
 IF NOT pg_try_advisory_xact_lock(806731,7001) OR NOT pg_try_advisory_xact_lock(806731,7100) THEN RETURN jsonb_build_object('status','busy'); END IF;
 FOREACH n IN ARRAY ARRAY[7002,7003,7010,7020,7030,7031] LOOP
  IF NOT pg_try_advisory_xact_lock(806731,n) THEN RETURN jsonb_build_object('status','busy'); END IF;
 END LOOP;
 -- A partially queued batch must not be processed or published between chunks.
 IF EXISTS (SELECT 1 FROM mis_internal.mis_gateway_enqueue_progress WHERE phase = 'queue') THEN
  RETURN jsonb_build_object('status','awaiting_enqueue');
 END IF;
 UPDATE mis_internal.mis_gateway_jobs older SET status='superseded',completed_at=now()
 WHERE status IN ('pending','failed') AND EXISTS(SELECT 1 FROM mis_internal.mis_gateway_jobs newer
  WHERE newer.invoice_key=older.invoice_key AND newer.batch_id>older.batch_id AND newer.status='completed');
 SELECT * INTO j FROM mis_internal.mis_gateway_jobs WHERE status='pending' AND next_attempt_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF FOUND THEN
  BEGIN
   r:=mis_internal.apply_gateway_invoice(j.id);
   INSERT INTO mis_internal.mis_gateway_events(job_id,event) VALUES(j.id,r->>'status');
   RETURN r||jsonb_build_object('jobId',j.id);
  EXCEPTION WHEN query_canceled OR OTHERS THEN
   GET STACKED DIAGNOSTICS err=RETURNED_SQLSTATE;
   INSERT INTO mis_internal.mis_gateway_events(job_id,event,code) VALUES(j.id,'attempt_failed',err);
   UPDATE mis_internal.mis_gateway_jobs SET attempts=attempts+1,error_code=err,
    status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END,
    next_attempt_at=now()+make_interval(secs=>least(900,30*(2^attempts)::integer)) WHERE id=j.id;
   RETURN jsonb_build_object('status','retry','jobId',j.id,'code',err);
  END;
 END IF;
 IF EXISTS(SELECT 1 FROM mis_internal.mis_gateway_jobs WHERE status IN ('pending','failed')) THEN RETURN jsonb_build_object('status','awaiting_jobs'); END IF;
 SELECT max(id) INTO target FROM mis_internal.mis_gateway_batches;
 SELECT * INTO pub FROM mis_internal.mis_gateway_publication WHERE singleton FOR UPDATE;
 IF target IS NULL OR (pub.stage='complete' AND pub.published_batch_id>=target) THEN RETURN jsonb_build_object('status','idle'); END IF;
 IF pub.target_batch_id<>target THEN
  UPDATE mis_internal.mis_gateway_publication SET target_batch_id=target,stage='finance',snapshot_after='' WHERE singleton RETURNING * INTO pub;
 END IF;
 PERFORM set_config('app.mis_worker','on',true);
 PERFORM set_config('app.mis_gateway_publish','on',true);
 BEGIN
  IF pub.stage='finance' THEN
   r:=public.refresh_finance_derived_data();
   UPDATE mis_internal.mis_gateway_publication SET stage='snapshots' WHERE singleton;
  ELSIF pub.stage='snapshots' THEN
   n:=0;
   FOR snap IN SELECT snapshot_key,start_date,end_date FROM public.dashboard_metric_snapshots
     WHERE snapshot_key>pub.snapshot_after ORDER BY snapshot_key LIMIT 5 LOOP
    PERFORM public.refresh_dashboard_metric_snapshot_cron(snap.start_date,snap.end_date);
    UPDATE mis_internal.mis_gateway_publication SET snapshot_after=snap.snapshot_key WHERE singleton;
    n:=n+1;
   END LOOP;
   r:=jsonb_build_object('status','completed','snapshots',n);
   IF n<5 THEN UPDATE mis_internal.mis_gateway_publication SET stage='complete',published_batch_id=target WHERE singleton; END IF;
  END IF;
  UPDATE mis_internal.mis_gateway_publication SET last_result=r-'error',updated_at=now() WHERE singleton;
  RETURN jsonb_build_object('status',CASE WHEN COALESCE(r->>'status','completed') IN ('completed','step_completed') THEN 'advanced' ELSE 'deferred' END,'stage',pub.stage);
 EXCEPTION WHEN query_canceled OR OTHERS THEN
  GET STACKED DIAGNOSTICS err=RETURNED_SQLSTATE, err_context=PG_EXCEPTION_CONTEXT;
  UPDATE mis_internal.mis_gateway_publication SET last_result=jsonb_build_object('status','failed','code',err,'context',err_context),updated_at=now() WHERE singleton;
  RETURN jsonb_build_object('status','deferred','stage',pub.stage,'code',err);
 END;
END;
$$;

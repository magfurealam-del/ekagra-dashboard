-- External MIS identifiers are source values, not internal foreign keys.
-- Keep those values only in the *_raw text columns and protect internal fields
-- from accidental population through jsonb_populate_record.
CREATE OR REPLACE FUNCTION mis_internal.gateway_source_record(p jsonb)
RETURNS public.mis_reports
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT jsonb_populate_record(
    NULL::public.mis_reports,
    (COALESCE(p, '{}'::jsonb) - ARRAY[
      'id', 'import_id', 'source_row_number', 'source_file_name', 'raw_row',
      'created_at', 'patient_id', 'admission_id', 'invoice_id',
      'invoice_line_item_id', 'department_id', 'doctor_id', 'second_doctor_id',
      'contributor_doctor_id', 'catalog_item_id', 'service_item_id',
      'service_category_id', 'patient_match_status',
      'patient_match_confidence', 'billing_match_status',
      'service_mapping_status'
    ]::text[])
    || jsonb_build_object(
      'invoice_id_raw', lower(btrim(p->>'invoice_id')),
      'admission_id_raw', p->'admission_id',
      'item_id_raw', p->'item_id'
    )
  );
$function$;

-- Retry only a bounded number of failed invoice jobs per call. The admin
-- route invokes this sequentially, so each UPDATE and audit insert is small.
CREATE OR REPLACE FUNCTION mis_internal.retry_mis_gateway_chunk(
  p_actor_id uuid,
  p_upload_id uuid,
  p_chunk_size integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  changed integer;
BEGIN
  PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);

  WITH target AS MATERIALIZED (
    SELECT j.id
    FROM mis_internal.mis_gateway_jobs j
    JOIN mis_internal.mis_gateway_batches b ON b.id=j.batch_id
    JOIN mis_internal.mis_upload_parses p ON p.id=b.parse_id
    WHERE p.upload_id=p_upload_id AND j.status='failed'
    ORDER BY j.id
    FOR UPDATE OF j SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_chunk_size,100),1),100)
  ), updated AS (
    UPDATE mis_internal.mis_gateway_jobs j
    SET status='pending', attempts=0, next_attempt_at=now(), error_code=NULL,
        completed_at=NULL
    FROM target t
    WHERE j.id=t.id
    RETURNING j.id
  )
  INSERT INTO mis_internal.mis_gateway_events(job_id,event,actor_id)
  SELECT id,'administrator_retry',p_actor_id FROM updated;

  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN jsonb_build_object('requeued',changed,'chunk_size',LEAST(GREATEST(COALESCE(p_chunk_size,100),1),100));
END
$function$;

CREATE OR REPLACE FUNCTION public.retry_mis_gateway_chunk(
  p_actor_id uuid,
  p_upload_id uuid,
  p_chunk_size integer DEFAULT 100
) RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT mis_internal.retry_mis_gateway_chunk(p_actor_id,p_upload_id,p_chunk_size)
$function$;

REVOKE ALL ON FUNCTION mis_internal.retry_mis_gateway_chunk(uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_mis_gateway_chunk(uuid,uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retry_mis_gateway_chunk(uuid,uuid,integer) TO service_role;

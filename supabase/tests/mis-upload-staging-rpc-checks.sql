-- Read-only post-migration assertions for the source-only intake RPC release.
-- Run against a disposable clone after M00, M01 and the staging RPC migration.
DO $checks$
DECLARE
  v_signature text;
BEGIN
  IF NOT has_schema_privilege('service_role', 'mis_internal', 'USAGE') THEN
    RAISE EXCEPTION 'server service role cannot enter the private intake schema';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.reserve_mis_upload(uuid,uuid,text,bigint,text)',
    'public.get_mis_upload_attempt(uuid,uuid)',
    'public.ingest_mis_upload(uuid,uuid,text,bigint,jsonb,text)',
    'public.stage_mis_upload_rows(uuid,uuid,uuid,jsonb)',
    'public.seal_mis_upload_parse(uuid,uuid,uuid)',
    'public.list_mis_uploads(uuid,integer)',
    'public.get_mis_upload_review(uuid,uuid)',
    'public.preview_mis_upload_candidates(uuid,uuid)'
  ] LOOP
    IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE')
       OR has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'RPC grants are not server-only for %', v_signature;
    END IF;
    IF (
      SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_signature::regprocedure
    ) THEN
      RAISE EXCEPTION 'public RPC wrapper must be SECURITY INVOKER: %', v_signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
     WHERE id = 'mis-upload-source'
       AND public = false
       AND file_size_limit = 20971520
       AND allowed_mime_types = ARRAY[
         'text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'
       ]::text[]
  ) THEN
    RAISE EXCEPTION 'private MIS source bucket is missing or misconfigured';
  END IF;

  IF EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobname ILIKE '%mis%upload%'
  ) THEN
    RAISE EXCEPTION 'source-only intake release unexpectedly added a scheduled worker';
  END IF;
END;
$checks$;

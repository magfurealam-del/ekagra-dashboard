-- CSV-only, immutable intake API. Canonical MIS tables and scheduled workers
-- are intentionally untouched. All operations are service-role RPCs called
-- only by server routes after verifying the user's current admin profile.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mis-upload-source',
  'mis-upload-source',
  false,
  20971520,
  ARRAY['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

DO $bucket_check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'mis-upload-source'
      AND (
        public
        OR file_size_limit <> 20971520
        OR allowed_mime_types IS DISTINCT FROM ARRAY[
          'text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'
        ]::text[]
      )
  ) THEN
    RAISE EXCEPTION 'Existing mis-upload-source bucket configuration is incompatible';
  END IF;
END;
$bucket_check$;

CREATE UNIQUE INDEX IF NOT EXISTS mis_import_validations_row_dedup_idx
  ON mis_internal.mis_import_validations (
    upload_id,
    parse_id,
    source_row_number,
    check_code,
    (COALESCE(details ->> 'field', ''))
  )
  WHERE parse_id IS NOT NULL AND source_row_number IS NOT NULL;

GRANT USAGE ON SCHEMA mis_internal TO service_role;

CREATE OR REPLACE FUNCTION mis_internal.assert_mis_upload_admin(p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF COALESCE((SELECT auth.jwt() ->> 'role'), '') <> 'service_role' THEN
    RAISE EXCEPTION 'server role required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.user_profiles up
     WHERE up.id = p_actor_id
       AND up.role = 'admin'
       AND up.is_active = true
  ) THEN
    RAISE EXCEPTION 'active administrator required' USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION mis_internal.assert_mis_upload_admin(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION mis_internal.assert_mis_upload_admin(uuid) TO service_role;

CREATE OR REPLACE FUNCTION mis_internal.reserve_mis_upload(
  p_actor_id uuid,
  p_request_idempotency_key uuid,
  p_file_name text,
  p_byte_count bigint,
  p_declared_media_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt_id uuid;
  v_object_key text;
  v_existing jsonb;
  v_count integer;
BEGIN
  PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);

  IF p_request_idempotency_key IS NULL
     OR p_file_name IS NULL
     OR btrim(p_file_name) = ''
     OR length(p_file_name) > 255
     OR p_file_name !~* '\.csv$'
     OR p_byte_count IS NULL
     OR p_byte_count < 1
     OR p_byte_count > 20971520
     OR p_declared_media_type IS NULL
     OR p_declared_media_type NOT IN (
       'text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'
     ) THEN
    RAISE EXCEPTION 'invalid upload reservation' USING ERRCODE = '22023';
  END IF;

  INSERT INTO mis_internal.mis_upload_attempts (
    actor_id, request_idempotency_key
  ) VALUES (
    p_actor_id, p_request_idempotency_key
  ) ON CONFLICT (actor_id, request_idempotency_key) DO NOTHING
  RETURNING id INTO v_attempt_id;

  IF v_attempt_id IS NULL THEN
    SELECT a.id INTO v_attempt_id
      FROM mis_internal.mis_upload_attempts a
     WHERE a.actor_id = p_actor_id
       AND a.request_idempotency_key = p_request_idempotency_key;

    SELECT e.details INTO v_existing
      FROM mis_internal.mis_upload_attempt_events e
     WHERE e.attempt_id = v_attempt_id AND e.event_type = 'reserved'
     ORDER BY e.occurred_at
     LIMIT 1;

    IF v_existing IS NULL
       OR v_existing ->> 'file_name' <> p_file_name
       OR (v_existing ->> 'byte_count')::bigint <> p_byte_count
       OR v_existing ->> 'media_type' <> p_declared_media_type THEN
      RAISE EXCEPTION 'idempotency key reused with different upload metadata'
        USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'attemptId', v_attempt_id,
      'objectKey', v_existing ->> 'object_key',
      'byteCount', p_byte_count
    );
  END IF;

  SELECT count(*)::integer INTO v_count
    FROM mis_internal.mis_upload_attempts a
   WHERE a.actor_id = p_actor_id
     AND a.started_at > clock_timestamp() - interval '24 hours';
  IF v_count > 20 THEN
    RAISE EXCEPTION 'daily upload reservation limit reached' USING ERRCODE = 'P0001';
  END IF;

  v_object_key := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY/MM/DD')
    || '/' || v_attempt_id::text || '.csv';

  INSERT INTO mis_internal.mis_upload_attempt_events (
    attempt_id, event_type, details
  ) VALUES (
    v_attempt_id,
    'reserved',
    jsonb_build_object(
      'object_key', v_object_key,
      'file_name', p_file_name,
      'byte_count', p_byte_count,
      'media_type', p_declared_media_type
    )
  );

  RETURN jsonb_build_object(
    'attemptId', v_attempt_id,
    'objectKey', v_object_key,
    'byteCount', p_byte_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION mis_internal.reserve_mis_upload(uuid, uuid, text, bigint, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION mis_internal.reserve_mis_upload(uuid, uuid, text, bigint, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_mis_upload(
  p_actor_id uuid,
  p_request_idempotency_key uuid,
  p_file_name text,
  p_byte_count bigint,
  p_declared_media_type text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT mis_internal.reserve_mis_upload(
    p_actor_id, p_request_idempotency_key, p_file_name, p_byte_count, p_declared_media_type
  );
$function$;
REVOKE ALL ON FUNCTION public.reserve_mis_upload(uuid, uuid, text, bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_mis_upload(uuid, uuid, text, bigint, text)
  TO service_role;

CREATE OR REPLACE FUNCTION mis_internal.get_mis_upload_attempt(
  p_actor_id uuid,
  p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_details jsonb;
BEGIN
  PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);

  SELECT e.details INTO v_details
    FROM mis_internal.mis_upload_attempts a
    JOIN mis_internal.mis_upload_attempt_events e ON e.attempt_id = a.id
   WHERE a.id = p_attempt_id
     AND a.actor_id = p_actor_id
     AND e.event_type = 'reserved'
   ORDER BY e.occurred_at
   LIMIT 1;

  RETURN COALESCE(v_details, '{}'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION mis_internal.get_mis_upload_attempt(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION mis_internal.get_mis_upload_attempt(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_mis_upload_attempt(p_actor_id uuid, p_attempt_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT mis_internal.get_mis_upload_attempt(p_actor_id, p_attempt_id);
$function$;
REVOKE ALL ON FUNCTION public.get_mis_upload_attempt(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mis_upload_attempt(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION mis_internal.ingest_mis_upload(
  p_actor_id uuid,
  p_attempt_id uuid,
  p_source_file_sha256 text,
  p_actual_byte_count bigint,
  p_parse jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt mis_internal.mis_upload_attempts%ROWTYPE;
  v_reserved jsonb;
  v_upload_id uuid;
  v_parse_id uuid;
  v_state text;
  v_duplicate boolean := false;
BEGIN
  PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);

  IF p_source_file_sha256 IS NULL
     OR p_source_file_sha256 !~ '^[0-9a-f]{64}$'
     OR p_actual_byte_count IS NULL
     OR p_actual_byte_count < 1 THEN
    RAISE EXCEPTION 'invalid verified file evidence' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_attempt
    FROM mis_internal.mis_upload_attempts a
   WHERE a.id = p_attempt_id AND a.actor_id = p_actor_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'upload attempt not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT e.details INTO v_reserved
    FROM mis_internal.mis_upload_attempt_events e
   WHERE e.attempt_id = p_attempt_id AND e.event_type = 'reserved'
   ORDER BY e.occurred_at
   LIMIT 1;
  IF v_reserved IS NULL
     OR (v_reserved ->> 'byte_count')::bigint <> p_actual_byte_count THEN
    RAISE EXCEPTION 'uploaded bytes do not match the reservation' USING ERRCODE = '22023';
  END IF;

  SELECT f.id INTO v_upload_id
    FROM mis_internal.mis_upload_files f
   WHERE f.storage_object_key = v_reserved ->> 'object_key';

  IF v_upload_id IS NULL THEN
    SELECT f.id INTO v_upload_id
      FROM mis_internal.mis_upload_files f
     WHERE f.source_namespace = 'ekagra_mis'
       AND f.source_file_sha256 = p_source_file_sha256;
    IF v_upload_id IS NOT NULL THEN
      v_duplicate := true;
      INSERT INTO mis_internal.mis_upload_attempt_events (
        attempt_id, event_type, details
      ) SELECT p_attempt_id, 'duplicate', jsonb_build_object('upload_id', v_upload_id)
        WHERE NOT EXISTS (
          SELECT 1 FROM mis_internal.mis_upload_attempt_events e
           WHERE e.attempt_id = p_attempt_id AND e.event_type = 'duplicate'
        );
      SELECT s.state INTO v_state
        FROM mis_internal.mis_upload_state s WHERE s.upload_id = v_upload_id;
      RETURN jsonb_build_object(
        'uploadId', v_upload_id, 'parseId', NULL, 'duplicate', true, 'state', v_state
      );
    END IF;

    INSERT INTO mis_internal.mis_upload_files (
      source_namespace, source_file_sha256, storage_object_key,
      original_file_name, byte_count, declared_media_type, received_by
    ) VALUES (
      'ekagra_mis', p_source_file_sha256, v_reserved ->> 'object_key',
      v_reserved ->> 'file_name', p_actual_byte_count,
      v_reserved ->> 'media_type', p_actor_id
    ) ON CONFLICT (source_namespace, source_file_sha256) DO NOTHING
    RETURNING id INTO v_upload_id;

    IF v_upload_id IS NULL THEN
      SELECT f.id INTO v_upload_id
        FROM mis_internal.mis_upload_files f
       WHERE f.source_namespace = 'ekagra_mis'
         AND f.source_file_sha256 = p_source_file_sha256;
      v_duplicate := true;
      INSERT INTO mis_internal.mis_upload_attempt_events (
        attempt_id, event_type, details
      ) SELECT p_attempt_id, 'duplicate', jsonb_build_object('upload_id', v_upload_id)
        WHERE NOT EXISTS (
          SELECT 1 FROM mis_internal.mis_upload_attempt_events e
           WHERE e.attempt_id = p_attempt_id AND e.event_type = 'duplicate'
        );
      SELECT s.state INTO v_state
        FROM mis_internal.mis_upload_state s WHERE s.upload_id = v_upload_id;
      RETURN jsonb_build_object(
        'uploadId', v_upload_id, 'parseId', NULL, 'duplicate', true, 'state', v_state
      );
    END IF;

    INSERT INTO mis_internal.mis_upload_state (upload_id, state, last_error_code)
    VALUES (v_upload_id, CASE WHEN p_parse IS NULL THEN 'failed' ELSE 'parsing' END, p_error_code);

    INSERT INTO mis_internal.mis_upload_attempt_events (
      attempt_id, event_type, details
    ) VALUES (
      p_attempt_id,
      'uploaded',
      jsonb_build_object('upload_id', v_upload_id, 'byte_count', p_actual_byte_count)
    );
  END IF;

  IF p_parse IS NULL THEN
    UPDATE mis_internal.mis_upload_state
       SET state = 'failed', state_version = state_version + 1,
           last_error_code = COALESCE(NULLIF(p_error_code, ''), 'parse_failed'),
           updated_at = clock_timestamp()
     WHERE upload_id = v_upload_id;
    INSERT INTO mis_internal.mis_upload_attempt_events (
      attempt_id, event_type, error_code, details
    ) SELECT p_attempt_id, 'parse_failed', COALESCE(NULLIF(p_error_code, ''), 'parse_failed'),
             jsonb_build_object('upload_id', v_upload_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM mis_internal.mis_upload_attempt_events e
         WHERE e.attempt_id = p_attempt_id AND e.event_type = 'parse_failed'
      );
    RETURN jsonb_build_object(
      'uploadId', v_upload_id, 'parseId', NULL, 'duplicate', false, 'state', 'failed'
    );
  END IF;

  IF jsonb_typeof(p_parse) IS DISTINCT FROM 'object'
     OR p_parse ->> 'parserVersion' IS NULL
     OR p_parse ->> 'schemaVersion' IS NULL
     OR p_parse ->> 'normalizationVersion' IS NULL
     OR p_parse ->> 'referenceYear' IS NULL
     OR p_parse ->> 'sourceRowCount' IS NULL
     OR p_parse ->> 'blankRecordCount' IS NULL
     OR p_parse ->> 'headerSha256' IS NULL
     OR p_parse ->> 'rowsetSha256' IS NULL
     OR (p_parse ->> 'referenceYear')::integer NOT BETWEEN 1890 AND 2200
     OR (p_parse ->> 'sourceRowCount')::integer NOT BETWEEN 0 AND 50000
     OR (p_parse ->> 'blankRecordCount')::integer NOT BETWEEN 0 AND 50000
     OR p_parse ->> 'headerSha256' !~ '^[0-9a-f]{64}$'
     OR p_parse ->> 'rowsetSha256' !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid parser manifest' USING ERRCODE = '22023';
  END IF;

  INSERT INTO mis_internal.mis_upload_parses (
    upload_id, parser_name, parser_version, schema_version,
    normalization_version, reference_year, source_row_count,
    blank_record_count, header_sha256, rowset_sha256, status
  ) VALUES (
    v_upload_id, 'mis-csv-parser', p_parse ->> 'parserVersion',
    p_parse ->> 'schemaVersion', p_parse ->> 'normalizationVersion',
    (p_parse ->> 'referenceYear')::integer,
    (p_parse ->> 'sourceRowCount')::integer,
    (p_parse ->> 'blankRecordCount')::integer,
    p_parse ->> 'headerSha256', p_parse ->> 'rowsetSha256', 'parsing'
  ) ON CONFLICT (
    upload_id, parser_name, parser_version, schema_version, normalization_version
  ) DO NOTHING
  RETURNING id INTO v_parse_id;

  IF v_parse_id IS NULL THEN
    SELECT p.id INTO v_parse_id
      FROM mis_internal.mis_upload_parses p
     WHERE p.upload_id = v_upload_id
       AND p.parser_name = 'mis-csv-parser'
       AND p.parser_version = p_parse ->> 'parserVersion'
       AND p.schema_version = p_parse ->> 'schemaVersion'
       AND p.normalization_version = p_parse ->> 'normalizationVersion';
  END IF;

  SELECT s.state INTO v_state
    FROM mis_internal.mis_upload_state s WHERE s.upload_id = v_upload_id;
  IF v_state = 'uploaded' OR v_state = 'failed' THEN
    UPDATE mis_internal.mis_upload_state
       SET state = 'parsing', state_version = state_version + 1,
           last_error_code = NULL, updated_at = clock_timestamp()
     WHERE upload_id = v_upload_id;
  END IF;

  RETURN jsonb_build_object(
    'uploadId', v_upload_id, 'parseId', v_parse_id,
    'duplicate', v_duplicate, 'state', 'parsing'
  );
END;
$function$;

REVOKE ALL ON FUNCTION mis_internal.ingest_mis_upload(uuid, uuid, text, bigint, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION mis_internal.ingest_mis_upload(uuid, uuid, text, bigint, jsonb, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ingest_mis_upload(
  p_actor_id uuid,
  p_attempt_id uuid,
  p_source_file_sha256 text,
  p_actual_byte_count bigint,
  p_parse jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT mis_internal.ingest_mis_upload(
    p_actor_id, p_attempt_id, p_source_file_sha256,
    p_actual_byte_count, p_parse, p_error_code
  );
$function$;
REVOKE ALL ON FUNCTION public.ingest_mis_upload(uuid, uuid, text, bigint, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_mis_upload(uuid, uuid, text, bigint, jsonb, text)
  TO service_role;

CREATE OR REPLACE FUNCTION mis_internal.stage_mis_upload_rows(
  p_actor_id uuid,
  p_attempt_id uuid,
  p_parse_id uuid,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row jsonb;
  v_issue jsonb;
  v_upload_id uuid;
  v_disposition text;
  v_existing_hash text;
BEGIN
  PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 250 THEN
    RAISE EXCEPTION 'row batch must contain at most 250 rows' USING ERRCODE = '22023';
  END IF;

  SELECT f.id INTO v_upload_id
    FROM mis_internal.mis_upload_attempts a
    JOIN mis_internal.mis_upload_attempt_events e ON e.attempt_id = a.id
    JOIN mis_internal.mis_upload_files f ON f.id = (e.details ->> 'upload_id')::uuid
   WHERE a.id = p_attempt_id AND a.actor_id = p_actor_id AND e.event_type = 'uploaded'
   ORDER BY e.occurred_at DESC
   LIMIT 1;
  IF v_upload_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM mis_internal.mis_upload_parses p
     WHERE p.id = p_parse_id AND p.upload_id = v_upload_id
  ) THEN
    RAISE EXCEPTION 'parse does not belong to this upload attempt' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    IF (v_row ->> 'sourceRowNumber') !~ '^\d+$'
       OR (v_row ->> 'rowSha256') !~ '^[0-9a-f]{64}$'
       OR jsonb_typeof(v_row -> 'rawCells') <> 'array'
       OR jsonb_typeof(v_row -> 'normalizedValues') <> 'object' THEN
      RAISE EXCEPTION 'invalid staged row payload' USING ERRCODE = '22023';
    END IF;

    v_disposition := CASE
      WHEN jsonb_typeof(v_row -> 'issues') = 'array'
       AND jsonb_array_length(v_row -> 'issues') > 0 THEN 'rejected'
      ELSE 'parsed'
    END;

    INSERT INTO mis_internal.mis_upload_rows (
      parse_id, source_row_number, raw_cells, normalized_values,
      row_sha256, disposition
    ) VALUES (
      p_parse_id,
      (v_row ->> 'sourceRowNumber')::integer,
      v_row -> 'rawCells', v_row -> 'normalizedValues',
      v_row ->> 'rowSha256', v_disposition
    ) ON CONFLICT (parse_id, source_row_number) DO NOTHING;
    SELECT r.row_sha256 INTO v_existing_hash
      FROM mis_internal.mis_upload_rows r
     WHERE r.parse_id = p_parse_id
       AND r.source_row_number = (v_row ->> 'sourceRowNumber')::integer;
    IF v_existing_hash IS DISTINCT FROM v_row ->> 'rowSha256' THEN
      RAISE EXCEPTION 'row replay digest mismatch' USING ERRCODE = '22000';
    END IF;

    FOR v_issue IN SELECT value FROM jsonb_array_elements(COALESCE(v_row -> 'issues', '[]'::jsonb))
    LOOP
      INSERT INTO mis_internal.mis_import_validations (
        upload_id, parse_id, source_row_number, check_code, outcome, details
      ) VALUES (
        v_upload_id, p_parse_id, (v_row ->> 'sourceRowNumber')::integer,
        v_issue ->> 'code', 'rejected', jsonb_build_object('field', v_issue ->> 'field')
      ) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  RETURN jsonb_array_length(p_rows);
END;
$function$;
REVOKE ALL ON FUNCTION mis_internal.stage_mis_upload_rows(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION mis_internal.stage_mis_upload_rows(uuid, uuid, uuid, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.stage_mis_upload_rows(
  p_actor_id uuid,
  p_attempt_id uuid,
  p_parse_id uuid,
  p_rows jsonb
)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT mis_internal.stage_mis_upload_rows(p_actor_id, p_attempt_id, p_parse_id, p_rows);
$function$;
REVOKE ALL ON FUNCTION public.stage_mis_upload_rows(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_mis_upload_rows(uuid, uuid, uuid, jsonb)
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
  v_validation_count integer;
  v_actual_rowset_sha text;
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

  SELECT count(*)::integer,
         encode(extensions.digest(
           convert_to(COALESCE(string_agg(
             r.source_row_number::text || ':' || r.row_sha256 || E'\n', ''
             ORDER BY r.source_row_number
           ), ''), 'UTF8'),
           'sha256'
         ), 'hex')
    INTO v_row_count, v_actual_rowset_sha
    FROM mis_internal.mis_upload_rows r
   WHERE r.parse_id = p_parse_id;

  IF v_row_count <> v_parse.source_row_count
     OR v_actual_rowset_sha <> v_parse.rowset_sha256 THEN
    RAISE EXCEPTION 'staged row count or rowset digest mismatch' USING ERRCODE = '22000';
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

  INSERT INTO mis_internal.mis_upload_attempt_events (
    attempt_id, event_type, details
  ) SELECT p_attempt_id,
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
REVOKE ALL ON FUNCTION mis_internal.seal_mis_upload_parse(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION mis_internal.seal_mis_upload_parse(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.seal_mis_upload_parse(
  p_actor_id uuid,
  p_attempt_id uuid,
  p_parse_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT mis_internal.seal_mis_upload_parse(p_actor_id, p_attempt_id, p_parse_id);
$function$;
REVOKE ALL ON FUNCTION public.seal_mis_upload_parse(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seal_mis_upload_parse(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION mis_internal.list_mis_uploads(
  p_actor_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);
  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.received_at DESC), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT f.received_at,
             jsonb_build_object(
               'uploadId', f.id,
               'fileName', f.original_file_name,
               'sha256', f.source_file_sha256,
               'byteCount', f.byte_count,
               'receivedAt', f.received_at,
               'state', s.state,
               'sourceRowCount', p.source_row_count,
               'blankRecordCount', p.blank_record_count,
               'validationCount', COALESCE(v.validation_count, 0)
             ) AS item
        FROM mis_internal.mis_upload_files f
        JOIN mis_internal.mis_upload_state s ON s.upload_id = f.id
        LEFT JOIN LATERAL (
          SELECT p0.* FROM mis_internal.mis_upload_parses p0
           WHERE p0.id = s.active_parse_id
           LIMIT 1
        ) p ON true
        LEFT JOIN LATERAL (
          SELECT count(*)::integer AS validation_count
            FROM mis_internal.mis_import_validations v0
           WHERE v0.parse_id = p.id AND v0.outcome IN ('rejected', 'conflict')
        ) v ON true
       ORDER BY f.received_at DESC
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
    ) x;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION mis_internal.list_mis_uploads(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION mis_internal.list_mis_uploads(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.list_mis_uploads(p_actor_id uuid, p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT mis_internal.list_mis_uploads(p_actor_id, p_limit);
$function$;
REVOKE ALL ON FUNCTION public.list_mis_uploads(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_mis_uploads(uuid, integer) TO service_role;

-- This is a source-only intake release. There is deliberately no RPC to
-- mutate canonical MIS data, invoke reconciliation, or enable a schedule.

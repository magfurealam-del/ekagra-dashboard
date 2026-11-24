-- CSV source row numbers are physical line numbers: the header is line 1 and
-- blank records are omitted from staging. Chunk receipts therefore may start
-- at line 2 and may have gaps. Validate verified, non-overlapping chunks and
-- total row counts instead of requiring dense line numbers.

ALTER TABLE mis_internal.mis_upload_chunk_verifications
  DROP CONSTRAINT IF EXISTS mis_upload_chunk_verifications_check1,
  ADD CONSTRAINT mis_upload_chunk_verifications_check1
    CHECK (row_count > 0 AND row_count <= end_row_number - start_row_number + 1);

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
  v_unique_row_count integer;
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

  SELECT count(*)::integer, count(DISTINCT (x.value ->> 'sourceRowNumber')::integer)::integer,
         min((x.value ->> 'sourceRowNumber')::integer),
         max((x.value ->> 'sourceRowNumber')::integer)
    INTO v_row_count, v_unique_row_count, v_start_row, v_end_row
    FROM jsonb_array_elements(p_rows) AS x(value);
  IF v_row_count <> jsonb_array_length(p_rows) OR v_unique_row_count <> v_row_count THEN
    RAISE EXCEPTION 'staging batch row numbers must be unique' USING ERRCODE = '22023';
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

-- A failed finalization may leave a complete parse staged but not active.
-- Review and list APIs expose the newest parse in that state so an authorized
-- administrator can resume sealing without uploading or staging the CSV again.
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
           WHERE p0.upload_id = f.id
           ORDER BY p0.created_at DESC
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

CREATE OR REPLACE FUNCTION mis_internal.get_mis_upload_review(
  p_actor_id uuid,
  p_upload_id uuid
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

  SELECT jsonb_build_object(
    'uploadId', f.id,
    'attemptId', uploaded.attempt_id,
    'fileName', f.original_file_name,
    'sha256', f.source_file_sha256,
    'byteCount', f.byte_count,
    'receivedAt', f.received_at,
    'state', s.state,
    'parse', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', p.id,
      'status', p.status,
      'parserVersion', p.parser_version,
      'schemaVersion', p.schema_version,
      'normalizationVersion', p.normalization_version,
      'referenceYear', p.reference_year,
      'sourceRowCount', p.source_row_count,
      'blankRecordCount', p.blank_record_count,
      'headerSha256', p.header_sha256,
      'rowsetSha256', p.rowset_sha256,
      'createdAt', p.created_at,
      'sealedAt', p.sealed_at
    ) END,
    'rowCounts', COALESCE(row_aggregate.counts, '{}'::jsonb),
    'validationSummary', COALESCE(validation_aggregate.summary, '[]'::jsonb)
  )
    INTO v_result
    FROM mis_internal.mis_upload_files f
    JOIN mis_internal.mis_upload_state s ON s.upload_id = f.id
    LEFT JOIN LATERAL (
      SELECT p0.* FROM mis_internal.mis_upload_parses p0
       WHERE p0.upload_id = f.id
       ORDER BY p0.created_at DESC
       LIMIT 1
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT e.attempt_id
        FROM mis_internal.mis_upload_attempt_events e
       WHERE e.event_type = 'uploaded'
         AND e.details ->> 'upload_id' = f.id::text
       ORDER BY e.occurred_at DESC
       LIMIT 1
    ) uploaded ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(x.disposition, x.row_count) AS counts
        FROM (
          SELECT r.disposition, count(*)::integer AS row_count
            FROM mis_internal.mis_upload_rows r
           WHERE r.parse_id = p.id
           GROUP BY r.disposition
        ) x
    ) row_aggregate ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'field', x.field,
          'code', x.check_code,
          'outcome', x.outcome,
          'count', x.issue_count
        ) ORDER BY x.field, x.check_code, x.outcome
      ) AS summary
        FROM (
          SELECT COALESCE(v.details ->> 'field', '_file') AS field,
                 v.check_code,
                 v.outcome,
                 count(*)::integer AS issue_count
            FROM mis_internal.mis_import_validations v
           WHERE v.parse_id = p.id
           GROUP BY 1, 2, 3
        ) x
    ) validation_aggregate ON true
   WHERE f.id = p_upload_id;

  RETURN v_result;
END;
$function$;

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
  v_chunks_nonoverlapping boolean;
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

  -- Source line numbers retain their original CSV positions. The per-chunk
  -- digest receipts, unique staged rows, and non-overlapping ranges prove that
  -- every staged row was checked without assuming line numbers are gap-free.
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
         COALESCE(bool_and(c.start_row_number > COALESCE(c.previous_end, 0)), true)
    INTO v_chunk_count, v_chunk_rows, v_chunk_min, v_chunk_max, v_chunks_nonoverlapping
    FROM ordered_chunks c;

  IF v_row_count <> v_parse.source_row_count
     OR v_chunk_rows <> v_parse.source_row_count
     OR v_chunk_count <> ceil(v_parse.source_row_count / 250.0)::integer
     OR (v_parse.source_row_count > 0 AND
         (v_min_row_number IS DISTINCT FROM v_chunk_min
          OR v_max_row_number IS DISTINCT FROM v_chunk_max
          OR NOT v_chunks_nonoverlapping)) THEN
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

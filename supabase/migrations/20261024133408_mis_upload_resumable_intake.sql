-- Resumable intake: a new attempt for identical bytes can complete the original parse.
-- A source file cannot silently be reinterpreted using another age reference year.
CREATE FUNCTION mis_internal.prepare_mis_upload(p_actor_id uuid,p_attempt_id uuid,p_sha256 text,p_byte_count bigint,p_manifest jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE r jsonb; p mis_internal.mis_upload_parses%rowtype; u uuid; n integer;
BEGIN
 PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_sha256,7101));
 r:=mis_internal.ingest_mis_upload(p_actor_id,p_attempt_id,p_sha256,p_byte_count,p_manifest,NULL);
 u:=(r->>'uploadId')::uuid;
 SELECT * INTO p FROM mis_internal.mis_upload_parses WHERE upload_id=u
  AND parser_name='mis-csv-parser' AND parser_version=p_manifest->>'parserVersion'
  AND schema_version=p_manifest->>'schemaVersion' AND normalization_version=p_manifest->>'normalizationVersion' FOR UPDATE;
 IF NOT FOUND THEN
  -- A prior receipt may have failed parsing before it created a manifest.
  INSERT INTO mis_internal.mis_upload_parses(upload_id,parser_name,parser_version,schema_version,normalization_version,
   reference_year,source_row_count,blank_record_count,header_sha256,rowset_sha256,status)
  VALUES(u,'mis-csv-parser',p_manifest->>'parserVersion',p_manifest->>'schemaVersion',p_manifest->>'normalizationVersion',
   (p_manifest->>'referenceYear')::integer,(p_manifest->>'sourceRowCount')::integer,(p_manifest->>'blankRecordCount')::integer,
   p_manifest->>'headerSha256',p_manifest->>'rowsetSha256','parsing') RETURNING * INTO p;
 END IF;
 IF (p.reference_year,p.source_row_count,p.blank_record_count,p.header_sha256,p.rowset_sha256)
  IS DISTINCT FROM ((p_manifest->>'referenceYear')::integer,(p_manifest->>'sourceRowCount')::integer,
   (p_manifest->>'blankRecordCount')::integer,p_manifest->>'headerSha256',p_manifest->>'rowsetSha256') THEN
  RAISE EXCEPTION 'same file requires identical parser configuration and manifest' USING ERRCODE='22023';
 END IF;
 INSERT INTO mis_internal.mis_upload_attempt_events(attempt_id,event_type,details)
 SELECT p_attempt_id,'uploaded',jsonb_build_object('upload_id',u,'resumed',true)
 WHERE NOT EXISTS(SELECT 1 FROM mis_internal.mis_upload_attempt_events WHERE attempt_id=p_attempt_id AND event_type='uploaded');
 SELECT count(*) INTO n FROM mis_internal.mis_import_validations WHERE parse_id=p.id AND outcome IN ('rejected','conflict');
 RETURN r||jsonb_build_object('parseId',p.id,'sealed',p.status='sealed','validationCount',n);
END $f$;
CREATE FUNCTION public.prepare_mis_upload(p_actor_id uuid,p_attempt_id uuid,p_sha256 text,p_byte_count bigint,p_manifest jsonb)
 RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $f$
 SELECT mis_internal.prepare_mis_upload(p_actor_id,p_attempt_id,p_sha256,p_byte_count,p_manifest) $f$;
REVOKE ALL ON FUNCTION mis_internal.prepare_mis_upload(uuid,uuid,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.prepare_mis_upload(uuid,uuid,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mis_internal.prepare_mis_upload(uuid,uuid,text,bigint,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_mis_upload(uuid,uuid,text,bigint,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION mis_internal.stage_mis_upload_rows(p_actor_id uuid, p_attempt_id uuid, p_parse_id uuid, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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

  -- Serialize stage/seal and concurrent retries on the parse row.
  PERFORM 1 FROM mis_internal.mis_upload_parses WHERE id=p_parse_id FOR UPDATE;
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

    IF EXISTS (SELECT 1 FROM mis_internal.mis_upload_rows r
      WHERE r.parse_id=p_parse_id AND r.source_row_number=(v_row->>'sourceRowNumber')::integer) THEN
      IF NOT EXISTS (SELECT 1 FROM mis_internal.mis_upload_rows r
        WHERE r.parse_id=p_parse_id AND r.source_row_number=(v_row->>'sourceRowNumber')::integer
        AND r.row_sha256=v_row->>'rowSha256' AND r.raw_cells=v_row->'rawCells'
        AND r.normalized_values=v_row->'normalizedValues' AND r.disposition=v_disposition) THEN
        RAISE EXCEPTION 'row replay payload mismatch' USING ERRCODE='22000';
      END IF;
      CONTINUE;
    END IF;
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
$function$


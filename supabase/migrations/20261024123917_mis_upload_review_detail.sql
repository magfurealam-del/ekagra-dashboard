-- Admin-only receipt detail for the source-only MIS intake release.
-- This RPC exposes metadata and aggregate validation counts, never staged PHI.

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
    'fileName', f.original_file_name,
    'sha256', f.source_file_sha256,
    'byteCount', f.byte_count,
    'receivedAt', f.received_at,
    'state', s.state,
    'parse', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
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
    LEFT JOIN mis_internal.mis_upload_parses p ON p.id = s.active_parse_id
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

REVOKE ALL ON FUNCTION mis_internal.get_mis_upload_review(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION mis_internal.get_mis_upload_review(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_mis_upload_review(uuid, uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT mis_internal.get_mis_upload_review($1, $2);
$function$;
REVOKE ALL ON FUNCTION public.get_mis_upload_review(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mis_upload_review(uuid, uuid)
  TO service_role;

-- Read-only invoice aggregate comparison. The legacy CSV has no revision,
-- stable line ID, or completeness marker, so these are candidates only.

CREATE OR REPLACE FUNCTION mis_internal.preview_mis_upload_candidates(
  p_actor_id uuid,
  p_upload_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_parse_id uuid;
  v_validation_count integer;
  v_result jsonb;
BEGIN
  PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);

  SELECT p.id INTO v_parse_id
    FROM mis_internal.mis_upload_state s
    JOIN mis_internal.mis_upload_parses p ON p.id = s.active_parse_id
   WHERE s.upload_id = p_upload_id
     AND p.status = 'sealed';
  IF v_parse_id IS NULL THEN
    RAISE EXCEPTION 'sealed parse not found for upload' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*)::integer INTO v_validation_count
    FROM mis_internal.mis_import_validations v
   WHERE v.parse_id = v_parse_id
     AND v.outcome IN ('rejected', 'conflict');
  IF v_validation_count > 0 OR EXISTS (
    SELECT 1 FROM mis_internal.mis_upload_rows r
     WHERE r.parse_id = v_parse_id AND r.disposition <> 'parsed'
  ) THEN
    RAISE EXCEPTION 'upload with validation findings cannot be compared' USING ERRCODE = '22023';
  END IF;

  WITH source_invoice AS (
    SELECT lower(btrim(r.normalized_values ->> 'invoice_id')) AS invoice_key,
           count(*)::integer AS source_rows,
           count(DISTINCT lower(btrim(r.normalized_values ->> 'item_id')))::integer AS distinct_item_keys,
           sum(NULLIF(r.normalized_values ->> 'sales_amount', '')::numeric) AS sales_amount,
           sum(NULLIF(r.normalized_values ->> 'item_discount', '')::numeric) AS item_discount,
           sum(NULLIF(r.normalized_values ->> 'net_sales', '')::numeric) AS net_sales,
           sum(NULLIF(r.normalized_values ->> 'net_collection', '')::numeric) AS net_collection,
           sum(NULLIF(r.normalized_values ->> 'cancellation_amount', '')::numeric) AS cancellation_amount
      FROM mis_internal.mis_upload_rows r
     WHERE r.parse_id = v_parse_id
     GROUP BY lower(btrim(r.normalized_values ->> 'invoice_id'))
  ), canonical_invoice AS (
    SELECT lower(btrim(m.invoice_id_raw)) AS invoice_key,
           count(*)::integer AS canonical_rows,
           count(DISTINCT lower(btrim(m.item_id_raw)))::integer AS distinct_item_keys,
           sum(m.sales_amount) AS sales_amount,
           sum(m.item_discount) AS item_discount,
           sum(m.net_sales) AS net_sales,
           sum(m.net_collection) AS net_collection,
           sum(m.cancellation_amount) AS cancellation_amount
      FROM public.mis_reports m
      JOIN source_invoice s ON lower(btrim(m.invoice_id_raw)) = s.invoice_key
     GROUP BY lower(btrim(m.invoice_id_raw))
  ), classified AS (
    SELECT s.*,
           c.canonical_rows,
           c.distinct_item_keys AS canonical_distinct_item_keys,
           CASE
             WHEN s.source_rows <> s.distinct_item_keys
               OR COALESCE(c.canonical_rows, 0) <> COALESCE(c.distinct_item_keys, 0)
               THEN 'ambiguous_item_key_candidate'
             WHEN c.canonical_rows IS NULL THEN 'new_invoice_candidate'
             WHEN s.source_rows = c.canonical_rows
              AND s.sales_amount = c.sales_amount
              AND s.item_discount = c.item_discount
              AND s.net_sales = c.net_sales
              AND s.net_collection = c.net_collection
              AND s.cancellation_amount = c.cancellation_amount
               THEN 'same_row_count_and_financial_totals_candidate'
             ELSE 'changed_row_count_or_financial_totals_candidate'
           END AS candidate_state
      FROM source_invoice s
      LEFT JOIN canonical_invoice c USING (invoice_key)
  ), summary AS (
    SELECT candidate_state, count(*)::integer AS invoice_count,
           sum(source_rows)::integer AS source_row_count,
           sum(COALESCE(canonical_rows, 0))::integer AS canonical_row_count
      FROM classified
     GROUP BY candidate_state
  )
  SELECT jsonb_build_object(
    'uploadId', p_upload_id,
    'parseId', v_parse_id,
    'mode', 'diagnostic_only',
    'canonicalWriteAllowed', false,
    'sourceAuthorityPresent', false,
    'reason', 'The export has no source revision, stable line ID, or completeness marker.',
    'invoiceCount', (SELECT count(*)::integer FROM source_invoice),
    'sourceRowCount', (SELECT COALESCE(sum(source_rows), 0)::integer FROM source_invoice),
    'classifications', COALESCE((
      SELECT jsonb_object_agg(candidate_state, jsonb_build_object(
        'invoices', invoice_count,
        'sourceRows', source_row_count,
        'currentRows', canonical_row_count
      )) FROM summary
    ), '{}'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION mis_internal.preview_mis_upload_candidates(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION mis_internal.preview_mis_upload_candidates(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.preview_mis_upload_candidates(uuid, uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT mis_internal.preview_mis_upload_candidates($1, $2);
$function$;
REVOKE ALL ON FUNCTION public.preview_mis_upload_candidates(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_mis_upload_candidates(uuid, uuid)
  TO service_role;

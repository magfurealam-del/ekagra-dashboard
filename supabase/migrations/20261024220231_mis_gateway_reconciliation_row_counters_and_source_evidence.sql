-- Gateway reconciliation runs represent a single authoritative invoice slice.
-- Counters therefore describe rows read from the staged file and inserted into
-- the canonical MIS slice; replaced snapshots are still represented as inserts
-- at this row-level import boundary.
DO $gateway_counter_patch$
DECLARE
  v_definition text;
  v_pattern text := $pattern$INSERT[[:space:]]+INTO public[.]mis_reconciliation_runs[[:space:]]*\([[:space:]]*mis_import_id[[:space:]]*,[[:space:]]*status[[:space:]]*,[[:space:]]*current_stage[[:space:]]*,[[:space:]]*source_row_count_snapshot[[:space:]]*,[[:space:]]*source_snapshot_hash[[:space:]]*,[[:space:]]*notes[[:space:]]*\)[[:space:]]*VALUES[[:space:]]*\([[:space:]]*imp[[:space:]]*,[[:space:]]*'started'[[:space:]]*,[[:space:]]*'gateway'[[:space:]]*,[[:space:]]*cnt[[:space:]]*,[[:space:]]*mis_internal[.]source_fingerprint\(imp\)[[:space:]]*,[[:space:]]*'Gateway invoice transaction'[[:space:]]*\);$pattern$;
  v_new text := $new$
 INSERT INTO public.mis_reconciliation_runs(
  mis_import_id,status,current_stage,source_row_count_snapshot,source_snapshot_hash,
  rows_read,rows_inserted,rows_updated,rows_skipped_duplicates,rows_rejected,notes)
 VALUES(imp,'started','gateway',cnt,mis_internal.source_fingerprint(imp),
  cnt,cnt,0,0,0,'Gateway invoice transaction; row counters describe staged rows applied to the canonical MIS invoice slice.');$new$;
  v_matches integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef('mis_internal.apply_gateway_invoice(bigint)'::pg_catalog.regprocedure)
    INTO v_definition;
  SELECT count(*) INTO v_matches FROM pg_catalog.regexp_matches(v_definition,v_pattern,'g');
  IF v_matches <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one gateway reconciliation-run insert; refusing to patch function';
  END IF;
  EXECUTE pg_catalog.regexp_replace(v_definition,v_pattern,v_new,'g');
END
$gateway_counter_patch$;

-- Repair the misleading zero counters on completed legacy gateway runs. Only
-- gateway-owned, zeroed rows with a recorded source snapshot are backfilled.
UPDATE public.mis_reconciliation_runs r
SET rows_read = r.source_row_count_snapshot,
    rows_inserted = r.source_row_count_snapshot,
    rows_updated = 0,
    rows_skipped_duplicates = 0,
    rows_rejected = 0,
    notes = concat_ws(' ', nullif(r.notes,''),
      'Counters backfilled: source rows read and inserted into canonical invoice slice.'),
    summary = coalesce(r.summary,'{}'::jsonb) || jsonb_build_object(
      'counter_semantics','gateway_invoice_slice_rows',
      'rows_read',r.source_row_count_snapshot,
      'rows_inserted',r.source_row_count_snapshot,
      'rows_updated',0,
      'rows_skipped_duplicates',0,
      'rows_rejected',0)
FROM public.mis_report_imports i
WHERE i.id = r.mis_import_id
  AND i.imported_by = 'mis_upload_gateway'
  AND i.status = 'completed'
  AND r.status = 'completed'
  AND r.notes LIKE 'Gateway invoice transaction%'
  AND r.source_row_count_snapshot IS NOT NULL
  AND r.rows_read = 0
  AND r.rows_inserted = 0
  AND r.rows_updated = 0
  AND r.rows_skipped_duplicates = 0
  AND r.rows_rejected = 0;

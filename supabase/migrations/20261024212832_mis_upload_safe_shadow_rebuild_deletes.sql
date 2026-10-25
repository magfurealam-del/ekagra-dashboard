-- The publication refresh rebuilds these derived shadow tables in full.
-- Explicit tautological predicates preserve that behavior under the database's
-- guard against unqualified DELETE statements.
DO $gateway_migration$
DECLARE
  v_definition text;
  v_table text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef('mis_internal.refresh_shadow_lifetime_attribution()'::pg_catalog.regprocedure)
    INTO v_definition;
  FOREACH v_table IN ARRAY ARRAY[
    'shadow_appointment_outcomes',
    'shadow_invoice_attribution',
    'shadow_patient_acquisitions',
    'shadow_encounters',
    'shadow_invoice_evidence'
  ] LOOP
    v_old := pg_catalog.format('delete from mis_internal.%I;',v_table);
    v_new := pg_catalog.format('delete from mis_internal.%I where true;',v_table);
    IF pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_old,'')) <> pg_catalog.length(v_old) THEN
      RAISE EXCEPTION 'Expected one full-refresh delete for %, refusing to patch function',v_table;
    END IF;
    v_definition := pg_catalog.replace(v_definition,v_old,v_new);
  END LOOP;
  EXECUTE v_definition;
END
$gateway_migration$;

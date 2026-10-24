-- Retain the attempt event as the audit record while removing transient error
-- state from completed unchanged jobs; keep future verified skips clean too.
DO $gateway_migration$
DECLARE
  v_definition text;
  v_old text := $old$UPDATE mis_internal.mis_gateway_jobs SET status='completed',completed_at=now(),result='{"action":"unchanged"}' WHERE id=j.id;$old$;
  v_new text := $new$UPDATE mis_internal.mis_gateway_jobs SET status='completed',completed_at=now(),error_code=NULL,result='{"action":"unchanged"}' WHERE id=j.id;$new$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef('mis_internal.apply_gateway_invoice(bigint)'::pg_catalog.regprocedure)
    INTO v_definition;
  IF pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_old,'')) <> pg_catalog.length(v_old) THEN
    RAISE EXCEPTION 'Expected one unchanged-job update; refusing to patch function';
  END IF;
  EXECUTE pg_catalog.replace(v_definition,v_old,v_new);
END
$gateway_migration$;

UPDATE mis_internal.mis_gateway_jobs
   SET error_code=NULL
 WHERE status='completed'
   AND result->>'action'='unchanged'
   AND error_code IS NOT NULL;

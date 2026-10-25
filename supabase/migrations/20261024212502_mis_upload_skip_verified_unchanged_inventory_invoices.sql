-- If the uploaded source and every canonical invoice invariant already match,
-- record the gateway job as unchanged. This also applies to the first gateway
-- adoption; rewriting identical invoice lines can violate inventory FKs.
DO $gateway_migration$
DECLARE
  v_definition text;
  v_pattern text := $pattern$-- Previously accepted repeats can be skipped; initial adoption is fully repaired[.]\s*IF EXISTS\(SELECT 1 FROM mis_internal[.]mis_gateway_jobs WHERE invoice_key=j[.]invoice_key AND status='completed'\) THEN\s*UPDATE mis_internal[.]mis_gateway_jobs SET status='completed',completed_at=now\(\),result='\{"action":"unchanged"\}' WHERE id=j[.]id;\s*RETURN jsonb_build_object\('status','completed','action','unchanged'\);\s*END IF;\s*END IF;\s*PERFORM set_config\('app[.]mis_worker','on',true\);$pattern$;
  v_replacement text := $replacement$-- Every source and canonical check above passed. Skipping is safe even for
  -- first gateway adoption and preserves any inventory movements on line IDs.
  UPDATE mis_internal.mis_gateway_jobs SET status='completed',completed_at=now(),result='{"action":"unchanged"}' WHERE id=j.id;
  RETURN jsonb_build_object('status','completed','action','unchanged');
 END IF;
 PERFORM set_config('app.mis_worker','on',true);$replacement$;
  v_matches integer;
  v_patched text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef('mis_internal.apply_gateway_invoice(bigint)'::pg_catalog.regprocedure)
    INTO v_definition;
  SELECT count(*) INTO v_matches FROM pg_catalog.regexp_matches(v_definition,v_pattern,'g');
  IF v_matches <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one unchanged-invoice guard, found %; refusing to patch function',v_matches;
  END IF;
  v_patched := pg_catalog.regexp_replace(v_definition,v_pattern,v_replacement,'g');
  EXECUTE v_patched;
END
$gateway_migration$;

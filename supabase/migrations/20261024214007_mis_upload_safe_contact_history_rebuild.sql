-- Keep safe-update protection enabled while allowing the audited full refresh
-- to replace its derived ledger inside the existing guarded publication stage.
DO $gateway_migration$
DECLARE
  v_definition text;
  v_old text := 'delete from mis_internal.crm_contact_history_v2;';
  v_new text := 'delete from mis_internal.crm_contact_history_v2 where true;';
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'mis_internal.refresh_crm_contact_history_v2()'::pg_catalog.regprocedure
  ) INTO v_definition;

  IF pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
       <> pg_catalog.length(v_old) THEN
    RAISE EXCEPTION 'Expected exactly one contact-history rebuild DELETE; refusing to patch function';
  END IF;

  EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
END
$gateway_migration$;

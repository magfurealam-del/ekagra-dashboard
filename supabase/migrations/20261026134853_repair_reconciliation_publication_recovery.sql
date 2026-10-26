-- PostgREST reads settings from the exposed RPC, not its nested implementation.
-- Keep the request below the hosted REST API's 60-second ceiling.
ALTER FUNCTION public.mis_gateway_tick() SET statement_timeout = '55s';

-- Only the existing service-role gateway establishes the publication context.
-- Independent legacy jobs retain their overnight-only behavior.
CREATE FUNCTION mis_internal.is_publication_window() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT mis_internal.is_overnight() OR (
  coalesce(current_setting('app.mis_gateway_publish',true),'')='on'
  AND EXISTS(SELECT 1 FROM mis_internal.mis_gateway_publication WHERE stage<>'complete' AND target_batch_id>0)
  AND NOT EXISTS(SELECT 1 FROM mis_internal.mis_gateway_jobs WHERE status IN ('pending','failed'))
 );
$$;
REVOKE ALL ON FUNCTION mis_internal.is_publication_window() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mis_internal.is_publication_window() TO service_role;

DO $patch$
DECLARE definition text; old_text text; new_text text; signature text;
BEGIN
 definition:=pg_get_functiondef('mis_internal.mis_gateway_tick()'::regprocedure);
 old_text:=$old$IF NOT mis_internal.is_overnight() THEN RETURN jsonb_build_object('status','outside_overnight_window'); END IF;$old$;
 new_text:=$new$IF NOT mis_internal.is_overnight() AND NOT (
  EXISTS(SELECT 1 FROM mis_internal.mis_gateway_publication WHERE stage<>'complete' AND target_batch_id>0)
  AND NOT EXISTS(SELECT 1 FROM mis_internal.mis_gateway_jobs WHERE status IN ('pending','failed'))
 ) THEN RETURN jsonb_build_object('status','outside_overnight_window'); END IF;$new$;
 IF (length(definition)-length(replace(definition,old_text,'')))<>length(old_text) THEN RAISE EXCEPTION 'Expected one gateway processing window'; END IF;
 EXECUTE replace(definition,old_text,new_text);
 FOREACH signature IN ARRAY ARRAY['mis_internal.refresh_shadow_lifetime_attribution()', 'mis_internal.refresh_crm_contact_history_v2()', 'mis_internal.refresh_gateway_marketing_attribution(bigint,integer)'] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  old_text:='mis_internal.is_overnight()';
  IF (length(definition)-length(replace(definition,old_text,'')))<>length(old_text) THEN RAISE EXCEPTION 'Expected one nested processing window in %',signature; END IF;
  EXECUTE replace(definition,old_text,'mis_internal.is_publication_window()');
 END LOOP;

 definition:=pg_get_functiondef('mis_internal.refresh_shadow_lifetime_attribution()'::regprocedure);
 old_text:=$old$ ELSIF v_step='evidence' THEN$old$;
 new_text:=$new$ ELSIF v_step='evidence' THEN
  -- Each committed page advances its cursor; interrupted pages roll back.
  DECLARE v_last bigint; v_count integer;
  BEGIN
  WITH batch AS MATERIALIZED (
   SELECT i.* FROM public.invoices i
   WHERE i.reconciliation_status='matched'
    AND i.id>coalesce((SELECT (findings->>'evidence_after')::bigint FROM mis_internal.shadow_attribution_runs WHERE id=v_run),0)
   ORDER BY i.id LIMIT 500
  ), flagged AS (
   SELECT l.invoice_id,count(*) FILTER(WHERE
    lower(btrim(coalesce(l.category_name,''))) IN ('opd services','daycare consultation','ipd consultation','therapeutics','ot/surgery','ot room charges','ipd services','emergency service')
    OR lower(btrim(coalesce(l.item_type,'')))='procedure'
    OR lower(coalesce(l.particulars,'')) ~ '(consultation|dressing charge|hbot|vacuarc|wound screening|outpatient procedure|therapy session)') clinical_count
   FROM public.invoice_line_items l JOIN batch b ON b.id=l.invoice_id GROUP BY l.invoice_id
  ), inserted AS (
   INSERT INTO mis_internal.shadow_invoice_evidence
    (invoice_id,patient_id,invoice_date,clinical_line_evidence,clinical_line_count,encounter_key,run_id)
   SELECT i.id,i.patient_id,i.invoice_date,
    (coalesce(f.clinical_count,0)>0 AND i.invoice_type IS DISTINCT FROM 'refund'),
    CASE WHEN i.invoice_type='refund' THEN 0 ELSE coalesce(f.clinical_count,0) END,
    CASE WHEN i.patient_type='IPD' OR i.invoice_type='ipd'
     THEN 'IPD:'||i.patient_id||':'||coalesce(i.admission_id::text,nullif(btrim(coalesce(i.an,'')),''),'day:'||i.invoice_date::text)
     WHEN i.invoice_type='refund' THEN 'ADJUSTMENT:'||i.id
     ELSE 'OUTPATIENT:'||i.patient_id||':'||i.invoice_date::text||':'||coalesce(mis_internal.doctor_match_key(i.consultant_name_raw),'invoice:'||i.id::text) END,
    v_run
   FROM batch i LEFT JOIN flagged f ON f.invoice_id=i.id
   RETURNING invoice_id
  ) SELECT max(invoice_id),count(*) INTO v_last,v_count FROM inserted;
  UPDATE mis_internal.shadow_attribution_runs
   SET findings=coalesce(findings,'{}'::jsonb)||jsonb_build_object('evidence_after',coalesce(v_last,(findings->>'evidence_after')::bigint,0)),
       refresh_step=CASE WHEN v_count<500 THEN 'encounters' ELSE 'evidence' END
   WHERE id=v_run;
  RETURN jsonb_build_object('status','step_completed','run_id',v_run,'step',CASE WHEN v_count<500 THEN 'encounters' ELSE 'evidence' END,'rows',v_count);
  END;
$new$;
 IF strpos(definition,old_text)=0 OR strpos(definition,' ELSIF v_step=''encounters'' THEN')=0 THEN RAISE EXCEPTION 'Expected evidence and encounter branches'; END IF;
 definition:=substr(definition,1,strpos(definition,old_text)-1)||new_text||substr(definition,strpos(definition,' ELSIF v_step=''encounters'' THEN'));
 EXECUTE definition;
END $patch$;
NOTIFY pgrst, 'reload schema';


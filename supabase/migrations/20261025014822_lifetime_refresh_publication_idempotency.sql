-- Once the gateway has published the current evidence revision, an independent
-- legacy schedule must not open another destructive rebuild of the same cache.
DO $patch$
DECLARE definition text; old_text text; new_text text; n integer;
BEGIN
 definition:=pg_get_functiondef('mis_internal.refresh_shadow_lifetime_attribution()'::regprocedure);
 old_text:=$old$ IF NOT mis_internal.is_overnight() THEN RETURN jsonb_build_object('status','outside_overnight_window'); END IF;$old$;
 new_text:=$new$
 IF coalesce(current_setting('app.mis_gateway_publish',true),'')<>'on'
  AND EXISTS(SELECT 1 FROM mis_internal.mis_gateway_publication p CROSS JOIN mis_internal.marketing_reconciliation_state s
   WHERE p.stage='complete' AND p.rules_version='marketing_pipeline_v2' AND p.marketing_revision=s.revision)
  AND EXISTS(SELECT 1 FROM mis_internal.shadow_attribution_runs WHERE status='completed' AND integrity_passed AND rule_version='source_evidence_v2')
  AND NOT EXISTS(SELECT 1 FROM mis_internal.shadow_attribution_runs r WHERE r.status='running' AND
   (r.refresh_step<>'clear' OR EXISTS(SELECT 1 FROM mis_internal.shadow_invoice_evidence e WHERE e.run_id=r.id)
    OR EXISTS(SELECT 1 FROM mis_internal.shadow_invoice_attribution a WHERE a.run_id=r.id)
    OR EXISTS(SELECT 1 FROM mis_internal.shadow_encounters e WHERE e.run_id=r.id)
    OR EXISTS(SELECT 1 FROM mis_internal.shadow_patient_acquisitions a WHERE a.run_id=r.id)
    OR EXISTS(SELECT 1 FROM mis_internal.shadow_appointment_outcomes a WHERE a.run_id=r.id)))
 THEN
  DECLARE pending record; done_id bigint;
  BEGIN
   SELECT max(id) INTO done_id FROM mis_internal.shadow_attribution_runs WHERE status='completed' AND integrity_passed AND rule_version='source_evidence_v2';
   FOR pending IN SELECT * FROM mis_internal.shadow_attribution_runs WHERE status='running' AND refresh_step='clear' FOR UPDATE LOOP
    UPDATE mis_internal.shadow_attribution_runs SET status='deferred',completed_at=now(),
     findings=coalesce(findings,'{}'::jsonb)||jsonb_build_object('reason','already_current_gateway_publication','superseded_by_completed_run_id',done_id)
     WHERE id=pending.id;
    INSERT INTO mis_internal.marketing_evidence_resolution_audit(run_id,kind,row_table,row_id,rule_version,before_data,after_data,evidence)
     VALUES(gen_random_uuid(),'redundant_lifetime_run_closed','mis_internal.shadow_attribution_runs',pending.id::text,'current_publication_noop_v1',
      jsonb_build_object('status',pending.status,'refresh_step',pending.refresh_step),jsonb_build_object('status','deferred'),
      jsonb_build_object('completed_run_id',done_id,'financial_cache_untouched',true));
   END LOOP;
   RETURN jsonb_build_object('status','idle_current_publication','completed_run_id',done_id);
  END;
 END IF;
 IF NOT mis_internal.is_overnight() THEN RETURN jsonb_build_object('status','outside_overnight_window'); END IF;
$new$;
 n:=(length(definition)-length(replace(definition,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Expected one lifetime processing-window guard; refusing patch'; END IF;
 EXECUTE replace(definition,old_text,new_text);
END $patch$;

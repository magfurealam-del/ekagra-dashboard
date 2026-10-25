-- Keep the existing request timeout by rebuilding lifetime attribution as
-- resumable transactions. Each tick commits one bounded step; the worker drains
-- those steps under the same advisory locks and authenticated service role.
ALTER TABLE mis_internal.shadow_attribution_runs
  ADD COLUMN IF NOT EXISTS refresh_step text;

CREATE OR REPLACE FUNCTION mis_internal.refresh_shadow_lifetime_attribution() RETURNS jsonb
 LANGUAGE plpgsql SET search_path='pg_catalog','public','mis_internal'
 SET statement_timeout='110s' SET lock_timeout='2s' AS $f$
DECLARE
 v_run bigint; v_step text; v_min date; v_max date; v_pending integer;
 v_invoices integer; v_patients integer; v_encounters integer; v_appointments integer;
 v_net numeric; v_collected numeric; v_attr numeric; v_unattr numeric;
 v_good boolean; v_history_start date;
BEGIN
 IF mis_internal.gateway_publication_blocked() THEN RETURN jsonb_build_object('status','deferred_gateway'); END IF;
 IF NOT mis_internal.is_overnight() THEN RETURN jsonb_build_object('status','outside_overnight_window'); END IF;
 IF NOT pg_try_advisory_xact_lock(806731,7030) THEN RETURN jsonb_build_object('status','already_running'); END IF;

 SELECT id,refresh_step INTO v_run,v_step
 FROM mis_internal.shadow_attribution_runs
 WHERE status='running' ORDER BY id DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN
  SELECT min(invoice_date),max(invoice_date),count(*),count(distinct patient_id),sum(net_bill),sum(total_collected)
   INTO v_min,v_max,v_invoices,v_patients,v_net,v_collected
   FROM public.invoices WHERE reconciliation_status='matched';
  SELECT count(*) INTO v_pending FROM public.invoices WHERE reconciliation_status IS DISTINCT FROM 'matched';
  v_pending:=v_pending+(SELECT count(*) FROM mis_internal.downstream_repair_queue WHERE status<>'completed');
  IF v_pending>0 OR v_invoices=0
    OR v_invoices<>(SELECT count(distinct lower(btrim(invoice_id_raw))) FROM public.mis_reports)
    OR (SELECT count(*) FROM public.mis_reports)<>(SELECT count(*) FROM public.invoice_line_items)
    OR EXISTS(SELECT 1 FROM public.mis_report_imports WHERE status NOT IN ('completed','failed'))
    OR NOT EXISTS(SELECT 1 FROM public.mis_reconciliation_runs r
      WHERE r.mis_import_id=(SELECT max(id) FROM public.mis_report_imports WHERE status='completed') AND r.status='completed')
  THEN RETURN jsonb_build_object('status','deferred_upstream','unmatched_or_pending',v_pending); END IF;
  INSERT INTO mis_internal.shadow_attribution_runs(status,source_last_date,rule_version,refresh_step,findings)
   VALUES('running',v_max,'mis_source_shadow_v1','clear',jsonb_build_object('history_start',v_min))
   RETURNING id INTO v_run;
  RETURN jsonb_build_object('status','step_completed','run_id',v_run,'step','clear');
 END IF;

 SELECT (findings->>'history_start')::date INTO v_history_start
 FROM mis_internal.shadow_attribution_runs WHERE id=v_run;

 IF v_step='clear' THEN
  DELETE FROM mis_internal.shadow_appointment_outcomes WHERE true;
  DELETE FROM mis_internal.shadow_invoice_attribution WHERE true;
  DELETE FROM mis_internal.shadow_patient_acquisitions WHERE true;
  DELETE FROM mis_internal.shadow_encounters WHERE true;
  DELETE FROM mis_internal.shadow_invoice_evidence WHERE true;
  UPDATE mis_internal.shadow_attribution_runs SET refresh_step='evidence' WHERE id=v_run;
  RETURN jsonb_build_object('status','step_completed','run_id',v_run,'step','evidence');
 ELSIF v_step='evidence' THEN
  WITH flagged AS (
   SELECT l.invoice_id,count(*) FILTER(WHERE
    lower(btrim(coalesce(l.category_name,''))) IN ('opd services','daycare consultation','ipd consultation','therapeutics','ot/surgery','ot room charges','ipd services','emergency service')
    OR lower(btrim(coalesce(l.item_type,'')))='procedure'
    OR lower(coalesce(l.particulars,'')) ~ '(consultation|dressing charge|hbot|vacuarc|wound screening|outpatient procedure|therapy session)') clinical_count
   FROM public.invoice_line_items l GROUP BY l.invoice_id
  )
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
  FROM public.invoices i LEFT JOIN flagged f ON f.invoice_id=i.id WHERE i.reconciliation_status='matched';
  UPDATE mis_internal.shadow_attribution_runs SET refresh_step='encounters' WHERE id=v_run;
  RETURN jsonb_build_object('status','step_completed','run_id',v_run,'step','encounters');
 ELSIF v_step='encounters' THEN
  INSERT INTO mis_internal.shadow_encounters
   (encounter_key,patient_id,care_setting,episode_start,episode_end,doctor_key,admission_id,invoice_count,clinical_invoice_count,clinical_verified,net_bill,total_collected,run_id)
  SELECT e.encounter_key,min(e.patient_id),
   CASE WHEN e.encounter_key LIKE 'IPD:%' THEN 'IPD' WHEN e.encounter_key LIKE 'ADJUSTMENT:%' THEN 'adjustment' ELSE 'outpatient_or_daycare' END,
   min(e.invoice_date),max(e.invoice_date),
   CASE WHEN e.encounter_key LIKE 'OUTPATIENT:%' THEN min(mis_internal.doctor_match_key(i.consultant_name_raw)) ELSE NULL END,
   min(i.admission_id),count(*),count(*) FILTER(WHERE e.clinical_line_evidence),bool_or(e.clinical_line_evidence),
   coalesce(sum(i.net_bill),0),coalesce(sum(i.total_collected),0),v_run
  FROM mis_internal.shadow_invoice_evidence e JOIN public.invoices i ON i.id=e.invoice_id GROUP BY e.encounter_key;
  UPDATE mis_internal.shadow_attribution_runs SET refresh_step='acquisitions' WHERE id=v_run;
  RETURN jsonb_build_object('status','step_completed','run_id',v_run,'step','acquisitions');
 ELSIF v_step='acquisitions' THEN
  WITH p_first AS (
   SELECT e.patient_id,min(e.invoice_date) first_invoice,min(e.invoice_date) FILTER(WHERE e.clinical_line_evidence) first_clinical
   FROM mis_internal.shadow_invoice_evidence e GROUP BY e.patient_id
  )
  INSERT INTO mis_internal.shadow_patient_acquisitions
   (patient_id,first_recorded_invoice_date,first_clinical_invoice_date,source,source_event_date,evidence_table,evidence_id,evidence_authentication,attribution_class,historical_window_start,notes,run_id)
  SELECT f.patient_id,f.first_invoice,f.first_clinical,
   CASE WHEN a.patient_id IS NOT NULL AND a.is_authenticated IS TRUE AND a.first_touch_date<=f.first_invoice
      AND nullif(lower(btrim(coalesce(a.first_touch_source,''))),'') IS NOT NULL AND lower(btrim(a.first_touch_source)) NOT IN('unknown','other')
    THEN lower(btrim(a.first_touch_source)) ELSE NULL END,
   a.first_touch_date,a.first_touch_evidence_table,a.first_touch_evidence_id,a.authentication_method,
   CASE WHEN a.patient_id IS NULL THEN 'missing_source'
    WHEN a.first_touch_date IS NULL OR a.first_touch_source IS NULL OR lower(btrim(a.first_touch_source)) IN ('unknown','other') THEN 'unknown_source'
    WHEN a.first_touch_date>f.first_invoice THEN 'late_source'
    WHEN a.is_authenticated IS DISTINCT FROM TRUE THEN 'unauthenticated_source' ELSE 'eligible_source' END,
   v_history_start,
   'Acquisition is provisional within MIS history; not necessarily first lifetime contact. Later marketing contacts do not own earlier revenue.',v_run
  FROM p_first f LEFT JOIN public.patient_marketing_attribution a ON a.patient_id=f.patient_id;
  UPDATE mis_internal.shadow_attribution_runs SET refresh_step='invoice_attribution' WHERE id=v_run;
  RETURN jsonb_build_object('status','step_completed','run_id',v_run,'step','invoice_attribution');
 ELSIF v_step='invoice_attribution' THEN
  INSERT INTO mis_internal.shadow_invoice_attribution(invoice_id,patient_id,invoice_date,encounter_key,attributed_source,attribution_class,net_bill,total_collected,run_id)
  SELECT i.id,i.patient_id,i.invoice_date,e.encounter_key,p.source,p.attribution_class,i.net_bill,i.total_collected,v_run
  FROM public.invoices i JOIN mis_internal.shadow_invoice_evidence e ON e.invoice_id=i.id
   JOIN mis_internal.shadow_patient_acquisitions p ON p.patient_id=i.patient_id;
  UPDATE mis_internal.shadow_attribution_runs SET refresh_step='appointments' WHERE id=v_run;
  RETURN jsonb_build_object('status','step_completed','run_id',v_run,'step','appointments');
 ELSIF v_step='appointments' THEN
  WITH appointments AS (
   SELECT a.id,a.patient_id,a.appointment_date,a.appointment_status,mis_internal.doctor_match_key(a.doctor_service) doctor_key FROM public.crm_appointments a
  ), bills AS (
   SELECT patient_id,invoice_date,count(*) any_bill FROM mis_internal.shadow_invoice_evidence GROUP BY patient_id,invoice_date
  ), clinical AS (
   SELECT e.patient_id,e.invoice_date,mis_internal.doctor_match_key(i.consultant_name_raw) doctor_key,count(*) exact_clinical
   FROM mis_internal.shadow_invoice_evidence e JOIN public.invoices i ON i.id=e.invoice_id
   WHERE e.clinical_line_evidence AND mis_internal.doctor_match_key(i.consultant_name_raw) IS NOT NULL
   GROUP BY e.patient_id,e.invoice_date,mis_internal.doctor_match_key(i.consultant_name_raw)
  ), same_doc AS (
   SELECT patient_id,appointment_date,doctor_key,count(*) same_doc_bookings FROM appointments WHERE doctor_key IS NOT NULL
   GROUP BY patient_id,appointment_date,doctor_key
  ), evidence AS (
   SELECT a.*,coalesce(b.any_bill,0) any_bill,coalesce(c.exact_clinical,0) exact_clinical,coalesce(d.same_doc_bookings,0) same_doc_bookings
   FROM appointments a LEFT JOIN bills b ON b.patient_id=a.patient_id AND b.invoice_date=a.appointment_date
    LEFT JOIN clinical c ON c.patient_id=a.patient_id AND c.invoice_date=a.appointment_date AND c.doctor_key=a.doctor_key
    LEFT JOIN same_doc d ON d.patient_id=a.patient_id AND d.appointment_date=a.appointment_date AND d.doctor_key=a.doctor_key
  )
  INSERT INTO mis_internal.shadow_appointment_outcomes
   (appointment_id,patient_id,appointment_date,existing_booking_status,matching_clinical_invoices,same_day_billing_invoices,duplicate_booking_count,evidence_outcome,run_id)
  SELECT id,patient_id,appointment_date,appointment_status,exact_clinical,any_bill,same_doc_bookings,
   CASE WHEN patient_id IS NULL THEN 'identity_unresolved'
    WHEN exact_clinical>0 AND same_doc_bookings>1 THEN 'ambiguous_booking_invoice_present'
    WHEN exact_clinical>0 THEN 'invoice_verified_attended'
    WHEN any_bill>0 THEN 'same_day_billing_not_visit_proof'
    WHEN appointment_date>(SELECT source_last_date FROM mis_internal.shadow_attribution_runs WHERE id=v_run) THEN 'awaiting_mis_coverage'
    WHEN appointment_date>(now() AT TIME ZONE 'Asia/Dhaka')::date-4 THEN 'pending_grace_period'
    ELSE 'no_qualifying_invoice_observed' END,v_run
  FROM evidence;
  UPDATE mis_internal.shadow_attribution_runs SET refresh_step='validate' WHERE id=v_run;
  RETURN jsonb_build_object('status','step_completed','run_id',v_run,'step','validate');
 ELSIF v_step='validate' THEN
  SELECT min(invoice_date),max(invoice_date),count(*),count(distinct patient_id),sum(net_bill),sum(total_collected)
   INTO v_min,v_max,v_invoices,v_patients,v_net,v_collected FROM public.invoices WHERE reconciliation_status='matched';
  SELECT count(*) INTO v_encounters FROM mis_internal.shadow_encounters;
  SELECT count(*) INTO v_appointments FROM mis_internal.shadow_appointment_outcomes;
  SELECT coalesce(sum(net_bill) FILTER(WHERE attributed_source IS NOT NULL),0),coalesce(sum(net_bill) FILTER(WHERE attributed_source IS NULL),0)
   INTO v_attr,v_unattr FROM mis_internal.shadow_invoice_attribution;
  v_good :=
   (SELECT count(*) FROM mis_internal.shadow_invoice_attribution)=v_invoices
   AND (SELECT count(*) FROM mis_internal.shadow_invoice_evidence)=v_invoices
   AND (SELECT count(*) FROM mis_internal.shadow_patient_acquisitions)=v_patients
   AND (SELECT count(*) FROM mis_internal.shadow_appointment_outcomes)=(SELECT count(*) FROM public.crm_appointments)
   AND (SELECT coalesce(sum(net_bill),0) FROM mis_internal.shadow_invoice_attribution)=v_net
   AND (SELECT coalesce(sum(total_collected),0) FROM mis_internal.shadow_invoice_attribution)=v_collected
   AND v_attr+v_unattr=v_net
   AND NOT EXISTS(SELECT 1 FROM mis_internal.shadow_invoice_attribution a JOIN public.invoices i ON i.id=a.invoice_id
    WHERE a.patient_id<>i.patient_id OR a.net_bill IS DISTINCT FROM i.net_bill OR a.total_collected IS DISTINCT FROM i.total_collected);
  IF NOT v_good THEN RAISE EXCEPTION 'Shadow attribution failed conservation or cardinality integrity check'; END IF;
  UPDATE mis_internal.shadow_attribution_runs SET status='completed',completed_at=now(),refresh_step='complete',
   source_last_date=v_max,invoice_count=v_invoices,patient_count=v_patients,encounter_count=v_encounters,appointment_count=v_appointments,
   net_bill_total=v_net,total_collected=v_collected,attributed_net_bill=v_attr,unattributed_net_bill=v_unattr,
   count_no_source=(SELECT count(*) FROM mis_internal.shadow_patient_acquisitions WHERE attribution_class='missing_source'),
   count_late_source=(SELECT count(*) FROM mis_internal.shadow_patient_acquisitions WHERE attribution_class='late_source'),
   count_unknown_source=(SELECT count(*) FROM mis_internal.shadow_patient_acquisitions WHERE attribution_class='unknown_source'),
   integrity_passed=true,findings=jsonb_build_object('source_coverage','historical_partial','clinical_invoice_based',true,'unknown_source_preserved',true,'revenue_balance',v_attr+v_unattr-v_net),
   error_details=NULL WHERE id=v_run;
  RETURN jsonb_build_object('status','completed','run_id',v_run,'invoices',v_invoices,'patients',v_patients,'encounters',v_encounters,
   'appointments',v_appointments,'net_bill',v_net,'attributed_net_bill',v_attr,'unattributed_net_bill',v_unattr,'balanced',v_good);
 ELSE
  RAISE EXCEPTION 'Unknown shadow attribution refresh step: %',v_step;
 END IF;
END
$f$;

DO $gateway_migration$
DECLARE
  v_definition text;
  v_old text := $old$RETURN jsonb_build_object('status',CASE WHEN COALESCE(r->>'status','completed')='completed' THEN 'advanced' ELSE 'deferred' END,'stage',pub.stage);$old$;
  v_new text := $new$RETURN jsonb_build_object('status',CASE WHEN COALESCE(r->>'status','completed') IN ('completed','step_completed') THEN 'advanced' ELSE 'deferred' END,'stage',pub.stage);$new$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef('mis_internal.mis_gateway_tick()'::pg_catalog.regprocedure) INTO v_definition;
  IF pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_old,'')) <> pg_catalog.length(v_old) THEN
    RAISE EXCEPTION 'Expected one worker return expression; refusing to patch function';
  END IF;
  EXECUTE pg_catalog.replace(v_definition,v_old,v_new);
END
$gateway_migration$;

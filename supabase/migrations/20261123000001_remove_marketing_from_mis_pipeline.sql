-- Remove marketing stages from the MIS gateway publication pipeline.
-- The pipeline now runs: finance → snapshots → complete.
-- Removes: marketing, lifetime, contacts, ad_outcomes stages and all shadow attribution checks.
-- Removes: rebuild_patient_marketing_attribution() calls from apply_gateway_invoice().

-- 1. Update the stage check constraint to remove marketing stage values.
ALTER TABLE mis_internal.mis_gateway_publication
  DROP CONSTRAINT mis_gateway_publication_stage_check;
ALTER TABLE mis_internal.mis_gateway_publication
  ADD CONSTRAINT mis_gateway_publication_stage_check
    CHECK (stage IN ('finance','snapshots','complete'));

-- 2. Reset the publication row if it is stuck in a marketing stage so the
--    finance→snapshots→complete pipeline starts cleanly on the next tick.
UPDATE mis_internal.mis_gateway_publication
SET stage = 'finance', snapshot_after = '', updated_at = now()
WHERE singleton
  AND stage IN ('marketing','lifetime','contacts','ad_outcomes');

-- 3. Rewrite apply_gateway_invoice() — remove rebuild_patient_marketing_attribution() calls.
CREATE OR REPLACE FUNCTION mis_internal.apply_gateway_invoice(p_job_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mis_internal, public, extensions
AS $$
DECLARE j mis_internal.mis_gateway_jobs%rowtype; p mis_internal.mis_upload_parses%rowtype;
 f mis_internal.mis_upload_files%rowtype; old_i public.invoices%rowtype; i public.invoices%rowtype;
 imp bigint; st text; cnt integer; old_payload jsonb; new_payload jsonb; a record; rr jsonb;
 expected_count integer; expected_net numeric; expected_lines numeric; actual_net numeric;
BEGIN
 SELECT * INTO STRICT j FROM mis_internal.mis_gateway_jobs WHERE id=p_job_id;
 SELECT x.* INTO STRICT p FROM mis_internal.mis_upload_parses x JOIN mis_internal.mis_gateway_batches b ON b.parse_id=x.id WHERE b.id=j.batch_id;
 SELECT * INTO STRICT f FROM mis_internal.mis_upload_files WHERE id=p.upload_id;
 IF EXISTS(SELECT 1 FROM mis_internal.mis_gateway_jobs WHERE invoice_key=j.invoice_key AND batch_id>j.batch_id AND status='completed') THEN
  UPDATE mis_internal.mis_gateway_jobs SET status='superseded',completed_at=now() WHERE id=j.id;
  RETURN jsonb_build_object('status','superseded');
 END IF;
 -- Legacy workers must be idle before canonical source ownership changes.
 IF EXISTS(SELECT 1 FROM public.mis_reconciliation_runs WHERE status NOT IN ('completed','failed')) THEN
  RAISE EXCEPTION 'legacy reconciliation still active' USING ERRCODE='55P03';
 END IF;
 SELECT jsonb_agg(payload ORDER BY payload::text) INTO old_payload FROM
  (SELECT mis_internal.gateway_row_payload(m) payload FROM public.mis_reports m WHERE lower(btrim(invoice_id_raw))=j.invoice_key) q;
 SELECT jsonb_agg(payload ORDER BY payload::text) INTO new_payload FROM
  (SELECT mis_internal.gateway_row_payload(mis_internal.gateway_source_record(normalized_values)) payload
   FROM mis_internal.mis_upload_rows WHERE parse_id=p.id AND lower(btrim(normalized_values->>'invoice_id'))=j.invoice_key) q;
 -- Even an unchanged source must have a matching downstream invoice; otherwise repair it.
 SELECT * INTO old_i FROM public.invoices WHERE lower(invoice_no)=j.invoice_key FOR UPDATE;
 IF old_payload IS NOT DISTINCT FROM new_payload AND old_i.reconciliation_status='matched'
   AND old_i.expected_line_item_count=(SELECT count(*) FROM public.invoice_line_items WHERE invoice_id=old_i.id)
   AND old_i.patient_id=(SELECT min(pat.id) FROM public.patients pat JOIN public.mis_reports m
     ON public.normalize_hospital_identifier(pat.hn)=public.normalize_hospital_identifier(m.hospital_number)
     WHERE lower(btrim(m.invoice_id_raw))=j.invoice_key)
   AND round((SELECT sum(m.net_sales) FROM public.mis_reports m WHERE lower(btrim(m.invoice_id_raw))=j.invoice_key),2)
     = (CASE WHEN old_i.invoice_type='refund' THEN -old_i.total_refund ELSE old_i.net_bill END)
   AND NOT EXISTS(SELECT 1 FROM public.invoice_line_items l LEFT JOIN public.mis_reports m
     ON m.import_id=(l.raw_line_json->>'mis_import_id')::bigint AND m.source_row_number=(l.raw_line_json->>'mis_source_row_number')::integer
     WHERE l.invoice_id=old_i.id AND (m.id IS NULL OR
       (l.net_amount,l.gross_amount,l.discount_amt,l.item_code,l.particulars,l.line_date,l.patient_id)
       IS DISTINCT FROM (round(m.net_sales,2),round(m.sales_amount,2),round(m.item_discount,2),m.item_id_raw,m.item_name,m.invoice_date,old_i.patient_id)))
   AND NOT EXISTS(SELECT 1 FROM mis_internal.downstream_repair_queue WHERE invoice_id=old_i.id AND status<>'completed') THEN
  -- Every source and canonical check above passed. Skipping is safe even for
  -- first gateway adoption and preserves any inventory movements on line IDs.
  UPDATE mis_internal.mis_gateway_jobs SET status='completed',completed_at=now(),error_code=NULL,result='{"action":"unchanged"}' WHERE id=j.id;
  RETURN jsonb_build_object('status','completed','action','unchanged');
 END IF;
 PERFORM set_config('app.mis_worker','on',true);
 IF EXISTS(SELECT 1 FROM public.invoice_inventory_movements mv JOIN public.invoice_line_items li ON li.id=mv.invoice_line_item_id WHERE li.invoice_id=old_i.id) THEN
  RAISE EXCEPTION 'inventory movements require reviewed reconciliation before replacing invoice lines' USING ERRCODE='23503';
 END IF;
 INSERT INTO mis_internal.mis_gateway_invoice_history(job_id,invoice_key,previous_rows,previous_invoice,previous_lines,previous_crm)
 SELECT j.id,j.invoice_key,COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.mis_reports m WHERE lower(btrim(invoice_id_raw))=j.invoice_key),'[]'),
  CASE WHEN old_i.id IS NOT NULL THEN to_jsonb(old_i) END,
  COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.invoice_line_items l WHERE invoice_id=old_i.id),'[]'),
  jsonb_build_object('billing',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.crm_billing_links x WHERE invoice_id=old_i.id),'[]'),
   'reconciliation',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.crm_invoice_reconciliation x WHERE lower(btrim(invoice_no))=j.invoice_key),'[]'),
   'appointments',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.crm_appointments x WHERE matched_invoice_id=old_i.id),'[]'),
   'leads',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.crm_leads x WHERE first_invoice_id=old_i.id),'[]'));
 SELECT count(*) INTO cnt FROM mis_internal.mis_upload_rows WHERE parse_id=p.id AND lower(btrim(normalized_values->>'invoice_id'))=j.invoice_key;
 -- This is a materialized invoice slice, not another original file receipt.
 INSERT INTO public.mis_report_imports(source_file_name,source_file_sha256,source_row_count,source_date_format,age_derivation_reference_year,imported_by,status,notes)
 VALUES(f.original_file_name,encode(extensions.digest('gateway-job:'||j.id::text,'sha256'),'hex'),cnt,'D/M/YYYY',p.reference_year,'mis_upload_gateway','loading',
  'Invoice slice; original immutable upload='||f.id||'; parse='||p.id||'; job='||j.id) RETURNING id INTO imp;
 DELETE FROM public.mis_reports WHERE lower(btrim(invoice_id_raw))=j.invoice_key;
 INSERT INTO public.mis_reports(import_id,source_row_number,source_file_name,
  doctors_department,hospital_number,patient_name,gender,age_years,birth_year,phone_mobile,marital_status,blood_group,address,
  patient_type,bill_module_name,admission_id_raw,admission_date,discharge_date,invoice_id_raw,invoice_by,invoice_date,invoice_datetime,
  doctor_name,second_doctor_name,contributor_doctor_name,mpo_name,parent_item_type_name,item_type_name,business_unit_name,item_id_raw,item_name,
  sales_amount,item_discount,net_sales,net_collection,cancellation_amount,raw_row)
 SELECT imp,r.source_row_number,f.original_file_name,
  m.doctors_department,public.normalize_hospital_identifier(m.hospital_number),m.patient_name,m.gender,m.age_years,m.birth_year,m.phone_mobile,m.marital_status,m.blood_group,m.address,
  m.patient_type,m.bill_module_name,m.admission_id_raw,m.admission_date,m.discharge_date,j.invoice_key,m.invoice_by,m.invoice_date,m.invoice_datetime,
  m.doctor_name,m.second_doctor_name,m.contributor_doctor_name,m.mpo_name,m.parent_item_type_name,m.item_type_name,m.business_unit_name,m.item_id_raw,m.item_name,
  m.sales_amount,m.item_discount,m.net_sales,m.net_collection,m.cancellation_amount,
  jsonb_build_object('upload_id',f.id,'parse_id',p.id,'source_row_number',r.source_row_number,'cells',r.raw_cells)
 FROM mis_internal.mis_upload_rows r CROSS JOIN LATERAL mis_internal.gateway_source_record(r.normalized_values) m
 WHERE r.parse_id=p.id AND lower(btrim(r.normalized_values->>'invoice_id'))=j.invoice_key;
 -- Mark the slice as synchronously owned; the legacy trigger sees this run and will not requeue it.

 INSERT INTO public.mis_reconciliation_runs(
  mis_import_id,status,current_stage,source_row_count_snapshot,source_snapshot_hash,
  rows_read,rows_inserted,rows_updated,rows_skipped_duplicates,rows_rejected,notes)
 VALUES(imp,'started','gateway',cnt,mis_internal.source_fingerprint(imp),
  cnt,cnt,0,0,0,'Gateway invoice transaction; row counters describe staged rows applied to the canonical MIS invoice slice.');
 FOREACH st IN ARRAY ARRAY['processing_patients','processing_doctors','processing_departments','processing_catalog','processing_identity_keys','processing_admissions'] LOOP
  IF st='processing_admissions' AND EXISTS(
   SELECT 1 FROM public.mis_reports src JOIN public.mis_reports other
    ON public.normalize_hospital_identifier(src.admission_id_raw)=public.normalize_hospital_identifier(other.admission_id_raw)
    AND public.normalize_hospital_identifier(src.hospital_number)<>public.normalize_hospital_identifier(other.hospital_number)
   WHERE src.import_id=imp AND other.import_id<>imp AND nullif(btrim(src.admission_id_raw),'') IS NOT NULL
  ) THEN RAISE EXCEPTION 'admission identity conflicts with another canonical invoice' USING ERRCODE='23514'; END IF;
  PERFORM mis_internal.step_dimensions(imp,st,'',3001);
 END LOOP;
 -- Clear stale line-derived metadata before authoritative reconstruction.
 DELETE FROM public.invoice_line_items WHERE invoice_id=old_i.id;
 PERFORM mis_internal.step_invoices(imp,'processing_invoices','',1);
 PERFORM mis_internal.step_invoices(imp,'processing_invoice_lines','',1);
 SELECT * INTO STRICT i FROM public.invoices WHERE lower(invoice_no)=j.invoice_key;
 -- The legacy admission upsert preserves NULLs and status. Authoritative snapshots do not.
 UPDATE public.admissions ad SET doctor_id=i.doctor_id,
  admitted_on=m.admission_date::timestamp AT TIME ZONE 'Asia/Dhaka',
  discharged_on=m.discharge_date::timestamp AT TIME ZONE 'Asia/Dhaka',
  status=CASE WHEN m.discharge_date IS NULL THEN 'Admitted' ELSE 'Discharged' END
 FROM public.mis_reports m WHERE m.import_id=imp AND ad.id=i.admission_id;
 SELECT count(*),sum(net_sales),sum(round(net_sales,2)) INTO expected_count,expected_net,expected_lines FROM public.mis_reports WHERE import_id=imp;
 SELECT sum(net_amount) INTO actual_net FROM public.invoice_line_items WHERE invoice_id=i.id;
 IF expected_count<>(SELECT count(*) FROM public.invoice_line_items WHERE invoice_id=i.id)
 OR expected_lines IS DISTINCT FROM actual_net
 OR round(expected_net,2) IS DISTINCT FROM (CASE WHEN expected_net<0 THEN -i.total_refund ELSE i.net_bill END)
 THEN RAISE EXCEPTION 'gateway financial conservation failed' USING ERRCODE='23514'; END IF;
 UPDATE public.invoices SET reconciliation_status='unchecked' WHERE id=i.id;
 IF mis_internal.repair_finance_one(i.id)<>'mis_verified' THEN RAISE EXCEPTION 'gateway finance validation failed' USING ERRCODE='23514'; END IF;
 PERFORM public.classify_invoice_care_setting(i.id);
 -- Archive above, then retract evidence owned by this invoice. Do not infer conversion from a shared phone or a latest lead.
 DELETE FROM public.crm_billing_links WHERE invoice_id=i.id;
 DELETE FROM public.crm_invoice_reconciliation WHERE lower(btrim(invoice_no))=j.invoice_key;
 UPDATE public.crm_appointments SET visit_verified=false,visit_verified_by=NULL,visit_verified_at=NULL,
  matched_invoice_id=NULL,visit_match_confidence=NULL,
  appointment_status=COALESCE(original_status_before_invoice,appointment_status),
  original_status_before_invoice=NULL,updated_by='mis_upload_gateway',updated_at=now()
 WHERE matched_invoice_id=i.id AND visit_verified_by='mis_exact_patient_date_doctor';
 UPDATE public.crm_leads SET conversion_verified=false,conversion_verified_at=NULL,first_invoice_id=NULL,first_visit_date=NULL,
  updated_by='mis_upload_gateway',updated_at=now() WHERE first_invoice_id=i.id;
 INSERT INTO public.crm_billing_links(source_table,source_record_id,source_event_date,patient_id,invoice_id,admission_id,invoice_date,
  attributed_revenue,attributed_line_item_revenue,match_method,match_confidence)
 VALUES('mis_reports',j.invoice_key,i.invoice_date,i.patient_id,i.id,i.admission_id,i.invoice_date,i.net_bill,actual_net,'mis_invoice_exact',1);
 INSERT INTO public.crm_invoice_reconciliation(patient_id,admission_id,invoice_no,invoice_date,match_method,match_confidence,match_status,attribution_type,source_truth)
 VALUES(i.patient_id,i.admission_id,j.invoice_key,i.invoice_date,'mis_invoice_exact',1,'matched','primary','mis_report');
 -- Only explicit clinical evidence is eligible; keep administrative billing from proving attendance.
 IF i.net_bill>0 AND EXISTS(SELECT 1 FROM public.invoice_line_items l WHERE l.invoice_id=i.id AND
   (lower(btrim(coalesce(l.category_name,''))) IN ('daycare consultation','opd services','therapeutics','ipd consultation','ot/surgery','ot room charges')
    OR l.item_type='procedure' OR l.particulars ~* '(consultation|dressing charge|hbot|vacuarc|wound screening|outpatient procedure|therapy session)')) THEN
  FOR a IN SELECT id FROM public.crm_appointments WHERE patient_id=i.patient_id AND appointment_date=i.invoice_date
   AND mis_internal.doctor_match_key(doctor_service)=mis_internal.doctor_match_key(i.consultant_name_raw) LOOP
   rr:=mis_internal.gateway_verify_appointment(a.id);
  END LOOP;
 END IF;
 INSERT INTO mis_internal.downstream_repair_queue(invoice_id,source_import_id,status,processed_at,result)
 VALUES(i.id,imp,'completed',now(),jsonb_build_object('gateway_job',j.id)) ON CONFLICT(invoice_id) DO UPDATE
 SET source_import_id=excluded.source_import_id,status='completed',processed_at=now(),result=excluded.result,last_error=NULL,updated_at=now();
 UPDATE public.mis_reconciliation_runs SET status='completed',current_stage='completed',completed_at=now() WHERE mis_import_id=imp;
 UPDATE public.mis_report_imports SET status='completed' WHERE id=imp;
 UPDATE mis_internal.mis_gateway_jobs SET status='completed',import_id=imp,completed_at=now(),error_code=NULL,
  result=jsonb_build_object('action',CASE WHEN old_i.id IS NULL THEN 'inserted' ELSE 'replaced' END,'rows',cnt) WHERE id=j.id;
 RETURN jsonb_build_object('status','completed','rows',cnt);
END
$$;

-- 4. Rewrite mis_gateway_tick() — pipeline is now finance → snapshots → complete.
--    Marketing, lifetime, contacts, ad_outcomes, and shadow attribution integrity check are removed.
CREATE OR REPLACE FUNCTION mis_internal.mis_gateway_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mis_internal, public, extensions
AS $$
DECLARE j mis_internal.mis_gateway_jobs%rowtype; r jsonb; pub mis_internal.mis_gateway_publication%rowtype;
 target bigint; snap record; n integer:=0; err text; err_context text;
BEGIN
 IF COALESCE(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 IF NOT mis_internal.is_overnight() AND NOT (
  EXISTS(SELECT 1 FROM mis_internal.mis_gateway_publication WHERE stage<>'complete' AND target_batch_id>0)
  AND NOT EXISTS(SELECT 1 FROM mis_internal.mis_gateway_jobs WHERE status IN ('pending','failed'))
 ) THEN RETURN jsonb_build_object('status','outside_overnight_window'); END IF;
 -- Same lock as legacy source processing plus a gateway enqueue/publication barrier.
 IF NOT pg_try_advisory_xact_lock(806731,7001) OR NOT pg_try_advisory_xact_lock(806731,7100) THEN RETURN jsonb_build_object('status','busy'); END IF;
 -- Cooperate with all existing downstream workers/finalizers.
 FOREACH n IN ARRAY ARRAY[7002,7003,7010,7020,7030,7031] LOOP
  IF NOT pg_try_advisory_xact_lock(806731,n) THEN RETURN jsonb_build_object('status','busy'); END IF;
 END LOOP;
 n:=0;
 UPDATE mis_internal.mis_gateway_jobs older SET status='superseded',completed_at=now()
 WHERE status IN ('pending','failed') AND EXISTS(SELECT 1 FROM mis_internal.mis_gateway_jobs newer
  WHERE newer.invoice_key=older.invoice_key AND newer.batch_id>older.batch_id AND newer.status='completed');
 SELECT * INTO j FROM mis_internal.mis_gateway_jobs WHERE status='pending' AND next_attempt_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF FOUND THEN
  BEGIN
   r:=mis_internal.apply_gateway_invoice(j.id);
   INSERT INTO mis_internal.mis_gateway_events(job_id,event) VALUES(j.id,r->>'status');
   RETURN r||jsonb_build_object('jobId',j.id);
  EXCEPTION WHEN query_canceled OR OTHERS THEN
   GET STACKED DIAGNOSTICS err=RETURNED_SQLSTATE;
   INSERT INTO mis_internal.mis_gateway_events(job_id,event,code) VALUES(j.id,'attempt_failed',err);
   UPDATE mis_internal.mis_gateway_jobs SET attempts=attempts+1,error_code=err,
    status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END,
    next_attempt_at=now()+make_interval(secs=>least(900,30*(2^attempts)::integer)) WHERE id=j.id;
   RETURN jsonb_build_object('status','retry','jobId',j.id,'code',err);
  END;
 END IF;
 IF EXISTS(SELECT 1 FROM mis_internal.mis_gateway_jobs WHERE status IN ('pending','failed')) THEN RETURN jsonb_build_object('status','awaiting_jobs'); END IF;
 SELECT max(id) INTO target FROM mis_internal.mis_gateway_batches;
 SELECT * INTO pub FROM mis_internal.mis_gateway_publication WHERE singleton FOR UPDATE;
 IF target IS NULL OR (pub.stage='complete' AND pub.published_batch_id>=target) THEN
  RETURN jsonb_build_object('status','idle');
 END IF;
 IF pub.target_batch_id<>target THEN
  UPDATE mis_internal.mis_gateway_publication SET target_batch_id=target,stage='finance',snapshot_after='' WHERE singleton RETURNING * INTO pub;
 END IF;
 PERFORM set_config('app.mis_worker','on',true);
 PERFORM set_config('app.mis_gateway_publish','on',true);
 BEGIN
  IF pub.stage='finance' THEN
   r:=public.refresh_finance_derived_data();
   UPDATE mis_internal.mis_gateway_publication SET stage='snapshots' WHERE singleton;
  ELSIF pub.stage='snapshots' THEN
   n:=0;
   -- Refresh all existing windows, including same-day historical corrections.
   FOR snap IN SELECT snapshot_key,start_date,end_date FROM public.dashboard_metric_snapshots
     WHERE snapshot_key>pub.snapshot_after ORDER BY snapshot_key LIMIT 5 LOOP
    PERFORM public.refresh_dashboard_metric_snapshot_cron(snap.start_date,snap.end_date);
    UPDATE mis_internal.mis_gateway_publication SET snapshot_after=snap.snapshot_key WHERE singleton;
    n:=n+1;
   END LOOP;
   r:=jsonb_build_object('status','completed','snapshots',n);
   IF n<5 THEN
    UPDATE mis_internal.mis_gateway_publication SET stage='complete',published_batch_id=target WHERE singleton;
   END IF;
  END IF;
  UPDATE mis_internal.mis_gateway_publication SET last_result=r-'error',updated_at=now() WHERE singleton;
  RETURN jsonb_build_object('status',CASE WHEN COALESCE(r->>'status','completed') IN ('completed','step_completed') THEN 'advanced' ELSE 'deferred' END,'stage',pub.stage);
 EXCEPTION WHEN query_canceled OR OTHERS THEN
  GET STACKED DIAGNOSTICS err=RETURNED_SQLSTATE, err_context=PG_EXCEPTION_CONTEXT;
  UPDATE mis_internal.mis_gateway_publication SET last_result=jsonb_build_object('status','failed','code',err,'context',err_context),updated_at=now() WHERE singleton;
  RETURN jsonb_build_object('status','deferred','stage',pub.stage,'code',err);
 END;
END
$$;

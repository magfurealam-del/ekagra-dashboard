-- Read-only executive report. Existing table RLS still applies to every source.
CREATE OR REPLACE FUNCTION public.get_doctor_patient_report_v2(p_start_date date, p_end_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles WHERE id=auth.uid() AND role='admin' AND is_active
  ) THEN RAISE EXCEPTION 'Active administrator access required' USING ERRCODE='42501'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date OR p_end_date-p_start_date > 365
  THEN RAISE EXCEPTION 'Choose a valid period of at most 366 days'; END IF;

  WITH report_crm_appointments AS MATERIALIZED (
    SELECT id,patient_id,lead_id,doctor_service,doctor_id,appointment_date,appointment_time,appointment_type,
      appointment_status,confirmation_status,created_by,created_at,previous_appointment_id,rescheduled_to_appointment_id,visit_verified,matched_invoice_id
    FROM public.crm_appointments
  ), report_crm_leads AS MATERIALIZED (
    SELECT id,patient_id,preferred_doctor,lead_name,phone,lead_status,created_at,agent_name FROM public.crm_leads
  ), report_patients AS MATERIALIZED (
    SELECT id,full_name,phone_e164,phone,hospital_patient_id,hn,area FROM public.patients
  ), mis_invoices AS MATERIALIZED (
    SELECT id,invoice_no,patient_id,invoice_date,consultant_name_raw,source_system,invoice_status,
      reconciliation_status,needs_review,net_bill,total_refund,invoice_type
    FROM public.invoices WHERE source_system='mis_report'
  ), mis_coverage AS (
    SELECT min(invoice_date) first_invoice_date,max(invoice_date) latest_invoice_date,count(*) invoice_count
    FROM mis_invoices
  ), clinical_invoices AS MATERIALIZED (
    SELECT DISTINCT li.invoice_id FROM public.invoice_line_items li
    JOIN mis_invoices i ON i.id=li.invoice_id
    WHERE i.invoice_date BETWEEN p_start_date AND p_end_date
      AND coalesce(li.needs_review,false)=false
      AND (lower(btrim(coalesce(li.category_name,''))) IN
        ('daycare consultation','opd services','therapeutics','ipd consultation','ot/surgery','ot room charges')
        OR li.item_type='procedure'
        OR li.particulars ~* '(consultation|dressing charge|hbot|vacuarc|wound screening|outpatient procedure|therapy session)')
  ), appointments AS MATERIALIZED (
    SELECT 'appointment:'||a.id record_id, 'appointment' kind, a.id appointment_id,
      coalesce(a.patient_id,l.patient_id) patient_id, a.lead_id,
      coalesce(nullif(a.doctor_service,''),d.name) raw_doctor,
      a.appointment_date report_date, 'Appointment date' date_basis,
      a.appointment_time, a.created_at recorded_at,
      coalesce(p.full_name,l.lead_name,'Name not recorded') patient_name,
      coalesce(nullif(p.phone_e164,''),nullif(p.phone,''),l.phone) phone,
      p.hospital_patient_id, p.hn, p.area,
      a.appointment_type service_type, a.appointment_status raw_status,
      CASE
        WHEN lower(a.appointment_status) IN ('completed','no-show','rescheduled','cancelled') THEN a.appointment_status
        WHEN lower(a.appointment_status)='confirmed' OR
          (lower(a.appointment_status) IN ('booked','scheduled','pending') AND lower(a.confirmation_status)='confirmed') THEN 'Confirmed'
        WHEN lower(a.appointment_status) IN ('booked','scheduled','pending') THEN 'Booked'
        ELSE 'Other' END status,
      CASE WHEN lower(a.confirmation_status)='confirmed' OR lower(a.appointment_status)='confirmed'
        THEN 'Response recorded' ELSE 'Not recorded' END pre_visit_response,
      (a.patient_id IS NOT NULL AND l.patient_id IS NOT NULL AND a.patient_id<>l.patient_id) identity_conflict,
      coalesce(a.visit_verified,false) legacy_verified_flag,a.matched_invoice_id legacy_invoice_id,a.created_by agent,
      a.previous_appointment_id, a.rescheduled_to_appointment_id,
      replacement.appointment_date replacement_date, replacement.appointment_time replacement_time,
      'CRM appointment' evidence
    FROM report_crm_appointments a
    LEFT JOIN report_crm_leads l ON l.id=a.lead_id
    LEFT JOIN report_patients p ON p.id=coalesce(a.patient_id,l.patient_id)
    LEFT JOIN public.doctors d ON d.id=a.doctor_id
    LEFT JOIN report_crm_appointments replacement ON replacement.id=a.rescheduled_to_appointment_id
    WHERE a.appointment_date BETWEEN p_start_date AND p_end_date
  ), declined AS (
    SELECT 'call:'||c.id record_id, coalesce(c.patient_id,l.patient_id) patient_id,c.lead_id,
      coalesce(nullif(a.doctor_service,''),nullif(l.preferred_doctor,'')) raw_doctor,
      coalesce(c.call_started_at,c.created_at) recorded_at,
      CASE WHEN c.call_started_at IS NULL THEN 'Call record created (call time missing)' ELSE 'Call date' END date_basis,
      coalesce(p.full_name,l.lead_name,'Name not recorded') patient_name,
      coalesce(nullif(p.phone_e164,''),nullif(p.phone,''),l.phone,c.phone_normalized) phone,
      p.hospital_patient_id,p.hn,p.area,c.agent_name agent,'Intake call outcome' evidence
    FROM public.crm_call_interactions c
    LEFT JOIN report_crm_leads l ON l.id=c.lead_id
    LEFT JOIN report_crm_appointments a ON a.id=c.appointment_id
    LEFT JOIN report_patients p ON p.id=coalesce(c.patient_id,l.patient_id)
    WHERE replace(lower(c.call_outcome),' ','_')='not_interested'
    UNION ALL
    SELECT 'outbound:'||c.id,coalesce(q.patient_id,a.patient_id,l.patient_id),l.id,
      coalesce(nullif(q.doctor_service,''),nullif(a.doctor_service,''),nullif(l.preferred_doctor,'')),
      coalesce(c.called_at,c.created_at),
      CASE WHEN c.called_at IS NULL THEN 'Call record created (call time missing)' ELSE 'Call date' END,
      coalesce(p.full_name,q.patient_name,l.lead_name,'Name not recorded'),
      coalesce(nullif(p.phone_e164,''),nullif(p.phone,''),q.phone,l.phone),
      p.hospital_patient_id,p.hn,p.area,c.assigned_agent,'Outbound call outcome'
    FROM public.outgoing_call_attempts c
    JOIN public.outgoing_call_queue q ON q.id=c.queue_id
    LEFT JOIN report_crm_appointments a ON a.id=CASE WHEN q.source_table IN ('validated_appointments','crm_appointments') AND q.source_id ~ '^[0-9]{1,18}$' THEN q.source_id::bigint END
    LEFT JOIN report_crm_leads l ON l.id=coalesce(q.lead_id,a.lead_id,CASE WHEN q.source_table='crm_leads' AND q.source_id ~ '^[0-9]{1,18}$' THEN q.source_id::bigint END)
    LEFT JOIN report_patients p ON p.id=coalesce(q.patient_id,a.patient_id,l.patient_id)
    WHERE replace(lower(coalesce(nullif(c.outcome_code,''),c.outcome)),' ','_')='not_interested'
    UNION ALL
    -- Legacy lead-only outcomes have no reliable outcome timestamp. Keep the date basis visible.
    SELECT 'lead:'||l.id,l.patient_id,l.id,nullif(l.preferred_doctor,''),l.created_at,
      'Lead created (outcome date unavailable)',coalesce(p.full_name,l.lead_name,'Name not recorded'),
      coalesce(nullif(p.phone_e164,''),nullif(p.phone,''),l.phone),p.hospital_patient_id,p.hn,p.area,
      l.agent_name,'Lead status only'
    FROM report_crm_leads l LEFT JOIN report_patients p ON p.id=l.patient_id
    WHERE replace(lower(l.lead_status),' ','_')='not_interested'
      AND NOT EXISTS (SELECT 1 FROM public.crm_call_interactions c WHERE c.lead_id=l.id AND replace(lower(c.call_outcome),' ','_')='not_interested')
      AND NOT EXISTS (SELECT 1 FROM public.outgoing_call_attempts c JOIN public.outgoing_call_queue q ON q.id=c.queue_id
        WHERE (q.lead_id=l.id OR (q.source_table='crm_leads' AND q.source_id=l.id::text))
        AND replace(lower(coalesce(nullif(c.outcome_code,''),c.outcome)),' ','_')='not_interested')
  ), declined_in_range AS MATERIALIZED (
    SELECT * FROM declined WHERE recorded_at >= p_start_date::timestamp AT TIME ZONE 'Asia/Dhaka'
      AND recorded_at < (p_end_date+1)::timestamp AT TIME ZONE 'Asia/Dhaka'
  ), resolved_names AS MATERIALIZED (
    SELECT raw_doctor,public.resolve_booking_doctor(raw_doctor) resolved_doctor
    FROM (SELECT raw_doctor FROM appointments UNION SELECT raw_doctor FROM declined_in_range
      UNION SELECT consultant_name_raw FROM mis_invoices WHERE invoice_date BETWEEN p_start_date AND p_end_date) names
  ), doctor_names AS MATERIALIZED (
    SELECT raw_doctor,coalesce(resolved_doctor,nullif(btrim(raw_doctor),''),'Doctor not recorded') doctor,
      CASE WHEN resolved_doctor NOT IN ('Screening Only','Dressing Change') THEN resolved_doctor END canonical_doctor
    FROM resolved_names
  ), eligible_invoices AS MATERIALIZED (
    SELECT i.*,n.canonical_doctor FROM mis_invoices i
    JOIN clinical_invoices c ON c.invoice_id=i.id
    JOIN doctor_names n ON n.raw_doctor IS NOT DISTINCT FROM i.consultant_name_raw
    WHERE i.invoice_date BETWEEN p_start_date AND p_end_date
      AND i.invoice_date <= (now() AT TIME ZONE 'Asia/Dhaka')::date
      AND i.invoice_status='final' AND i.reconciliation_status='matched' AND i.needs_review IS FALSE
      AND i.net_bill>0 AND coalesce(i.total_refund,0)<i.net_bill
      AND i.invoice_type NOT IN ('refund','pharmacy','pathology') AND n.canonical_doctor IS NOT NULL
  ), invoice_evidence AS MATERIALIZED (
    SELECT patient_id,invoice_date,canonical_doctor,count(*) invoice_count,
      jsonb_agg(jsonb_build_object('id',id,'number',invoice_no,'date',invoice_date,'doctor',canonical_doctor) ORDER BY id) invoices
    FROM eligible_invoices GROUP BY patient_id,invoice_date,canonical_doctor
  ), named_appointments AS MATERIALIZED (
    SELECT a.*,n.doctor,n.canonical_doctor FROM appointments a
    JOIN doctor_names n ON n.raw_doctor IS NOT DISTINCT FROM a.raw_doctor
  ), booking_counts AS (
    SELECT patient_id,report_date,canonical_doctor,count(*) booking_count FROM named_appointments
    WHERE lower(coalesce(raw_status,'')) NOT IN ('cancelled','rescheduled')
    GROUP BY patient_id,report_date,canonical_doctor
  ), visit_matches AS MATERIALIZED (
    SELECT a.*,coalesce(e.invoice_count,0) candidate_invoice_count,e.invoices,
      coalesce(b.booking_count,0) booking_count,
      (lower(coalesce(a.raw_status,''))='completed' AND NOT a.identity_conflict
        AND e.invoice_count>0 AND b.booking_count=1) IS TRUE mis_visit_confirmed,
      CASE WHEN a.identity_conflict THEN 'Patient and lead identity conflict — review required'
        WHEN e.invoice_count>0 AND b.booking_count>1 THEN 'Multiple bookings match the same patient, doctor and day — review required'
        WHEN e.invoice_count>0 AND lower(coalesce(a.raw_status,''))<>'completed' THEN 'MIS evidence conflicts with the recorded appointment outcome — review required'
        WHEN e.invoice_count>0 THEN 'Completed visit verified by matching clinical MIS invoice'
        WHEN a.patient_id IS NULL THEN 'No linked patient ID — MIS visit cannot be verified'
        WHEN a.canonical_doctor IS NULL THEN 'No specific matched doctor — MIS visit cannot be verified'
        WHEN (SELECT latest_invoice_date FROM mis_coverage) IS NULL THEN 'No MIS invoices available'
        WHEN a.report_date>(SELECT latest_invoice_date FROM mis_coverage) THEN 'Awaiting MIS verification — visit is after the latest available invoice date'
        ELSE 'No qualifying clinical MIS invoice for this patient, doctor and visit date' END verification_reason
    FROM named_appointments a
    LEFT JOIN invoice_evidence e ON e.patient_id=a.patient_id AND e.invoice_date=a.report_date AND e.canonical_doctor=a.canonical_doctor
    LEFT JOIN booking_counts b ON b.patient_id=a.patient_id AND b.report_date=a.report_date AND b.canonical_doctor=a.canonical_doctor
  ), verified_appointments AS (
    SELECT a.*,CASE WHEN mis_visit_confirmed THEN 'Confirmed visit'
      WHEN identity_conflict OR (candidate_invoice_count>0 AND (booking_count>1 OR lower(coalesce(raw_status,''))<>'completed')) THEN 'Review required'
      WHEN lower(raw_status)='completed' THEN 'Completion reported'
      WHEN lower(raw_status) IN ('booked','scheduled','pending','confirmed') THEN 'Booked'
      WHEN lower(raw_status)='no-show' THEN 'No-show'
      WHEN lower(raw_status)='rescheduled' THEN 'Rescheduled'
      WHEN lower(raw_status)='cancelled' THEN 'Cancelled'
      ELSE 'Other' END visit_status
    FROM visit_matches a
  ), declined_period AS (
    SELECT d.*,n.doctor,
      coalesce('patient:'||patient_id,'lead:'||lead_id,record_id) identity_key,
      (recorded_at AT TIME ZONE 'Asia/Dhaka')::date report_date
    FROM declined_in_range d JOIN doctor_names n ON n.raw_doctor IS NOT DISTINCT FROM d.raw_doctor
  ), declined_people AS (
    SELECT DISTINCT ON (doctor,identity_key) * FROM declined_period
    ORDER BY doctor,identity_key,recorded_at DESC,record_id
  ), records AS (
    SELECT (to_jsonb(a)-'invoices'-'status'-'visit_status')||jsonb_build_object(
      'status',visit_status,'mis_invoices',CASE WHEN mis_visit_confirmed THEN invoices ELSE '[]'::jsonb END,
      'identity_key',coalesce('patient:'||patient_id,'lead:'||lead_id,record_id)) row
    FROM verified_appointments a
    UNION ALL
    SELECT to_jsonb(d)||jsonb_build_object('kind','not_interested','status','Not interested') FROM declined_people d
  )
  SELECT jsonb_build_object('version',2,'mis_coverage',(SELECT to_jsonb(c) FROM mis_coverage c),'read_at',now(),'start_date',p_start_date,'end_date',p_end_date,
    'records',coalesce(jsonb_agg(row ORDER BY row->>'report_date' DESC,row->>'record_id'),'[]'::jsonb)) INTO result FROM records;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_doctor_patient_report_v2(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_doctor_patient_report_v2(date,date) TO authenticated;

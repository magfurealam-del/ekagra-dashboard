-- Read-only executive report. Existing table RLS still applies to every source.
CREATE OR REPLACE FUNCTION public.get_doctor_patient_report(p_start_date date, p_end_date date)
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
      appointment_status,confirmation_status,created_by,created_at,previous_appointment_id,rescheduled_to_appointment_id
    FROM public.crm_appointments
  ), report_crm_leads AS MATERIALIZED (
    SELECT id,patient_id,preferred_doctor,lead_name,phone,lead_status,created_at,agent_name FROM public.crm_leads
  ), report_patients AS MATERIALIZED (
    SELECT id,full_name,phone_e164,phone,hospital_patient_id,hn,area FROM public.patients
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
      a.confirmation_status, a.created_by agent,
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
  ), doctor_names AS MATERIALIZED (
    SELECT raw_doctor,coalesce(public.resolve_booking_doctor(raw_doctor),nullif(btrim(raw_doctor),''),'Doctor not recorded') doctor
    FROM (SELECT raw_doctor FROM appointments UNION SELECT raw_doctor FROM declined_in_range) names
  ), declined_period AS (
    SELECT d.*,n.doctor,
      coalesce('patient:'||patient_id,'lead:'||lead_id,record_id) identity_key,
      (recorded_at AT TIME ZONE 'Asia/Dhaka')::date report_date
    FROM declined_in_range d JOIN doctor_names n ON n.raw_doctor IS NOT DISTINCT FROM d.raw_doctor
  ), declined_people AS (
    SELECT DISTINCT ON (doctor,identity_key) * FROM declined_period
    ORDER BY doctor,identity_key,recorded_at DESC,record_id
  ), records AS (
    SELECT to_jsonb(a)||jsonb_build_object(
      'doctor',n.doctor,
      'identity_key',coalesce('patient:'||patient_id,'lead:'||lead_id,record_id)) row
    FROM appointments a JOIN doctor_names n ON n.raw_doctor IS NOT DISTINCT FROM a.raw_doctor
    UNION ALL
    SELECT to_jsonb(d)||jsonb_build_object('kind','not_interested','status','Not interested') FROM declined_people d
  )
  SELECT jsonb_build_object('version',1,'read_at',now(),'start_date',p_start_date,'end_date',p_end_date,
    'records',coalesce(jsonb_agg(row ORDER BY row->>'report_date' DESC,row->>'record_id'),'[]'::jsonb)) INTO result FROM records;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_doctor_patient_report(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_doctor_patient_report(date,date) TO authenticated;

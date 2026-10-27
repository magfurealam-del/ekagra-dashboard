-- Keep the existing security-invoker view and replace its raw-name conflict check.
CREATE OR REPLACE VIEW public.calendar_appointment_detail WITH (security_invoker=true) AS
 SELECT ca.id AS appointment_id,
    ca.appointment_date,
    ca.appointment_time,
    ca.doctor_service,
    ca.appointment_type AS service_type,
    ca.appointment_status,
    ca.confirmation_status,
    ca.no_show_risk,
    ca.night_before_status,
    ca.morning_of_status,
    ca.notes,
    COALESCE(ca.patient_id, p2.id) AS patient_id,
    COALESCE(p.full_name, p2.full_name, l.lead_name) AS patient_name,
    COALESCE(p.phone_e164, p2.phone_e164, l.phone) AS phone,
    COALESCE(p.area, p2.area) AS location,
    COALESCE(p.hn, p2.hn) AS hn,
    COALESCE(p.hospital_patient_id, p2.hospital_patient_id) AS hospital_patient_id,
    COALESCE(p.patient_type, p2.patient_type) AS patient_type,
    nb.outcome AS nb_outcome,
    nb.agent_name AS nb_agent,
    nb.called_at AS nb_called_at,
    mo.outcome AS mo_outcome,
    mo.agent_name AS mo_agent,
    mo.called_at AS mo_called_at,
    ca.updated_by AS status_updated_by,
    ca.updated_at AS status_updated_at,
    COALESCE(p.updated_by, p2.updated_by) AS patient_updated_by,
    COALESCE(p.updated_at, p2.updated_at) AS patient_updated_at,
    dav.conflict_reason AS doctor_availability_conflict
   FROM ((((((crm_appointments ca
     LEFT JOIN crm_leads l ON ((l.id = ca.lead_id)))
     LEFT JOIN patients p ON ((p.id = ca.patient_id)))
     LEFT JOIN LATERAL ( SELECT p3.id,
            p3.full_name,
            p3.phone_e164,
            p3.area,
            p3.hn,
            p3.hospital_patient_id,
            p3.patient_type,
            p3.updated_by,
            p3.updated_at
           FROM patients p3
          WHERE ((ca.patient_id IS NULL) AND (p3.phone_e164 = l.phone_normalized))
          ORDER BY p3.id
         LIMIT 1) p2 ON (true))
     LEFT JOIN LATERAL ( SELECT acc.outcome,
            acc.agent_name,
            acc.called_at
           FROM appointment_confirmation_calls acc
          WHERE ((acc.appointment_id = ca.id) AND (acc.call_type = 'night_before'::text))
          ORDER BY acc.called_at DESC
         LIMIT 1) nb ON (true))
     LEFT JOIN LATERAL ( SELECT acc.outcome,
            acc.agent_name,
            acc.called_at
           FROM appointment_confirmation_calls acc
          WHERE ((acc.appointment_id = ca.id) AND (acc.call_type = 'morning_of'::text))
          ORDER BY acc.called_at DESC
         LIMIT 1) mo ON (true))
     LEFT JOIN LATERAL (
 SELECT CASE WHEN ca.appointment_date >= (now() AT TIME ZONE 'Asia/Dhaka')::date
 AND public.resolve_booking_doctor(ca.doctor_service) IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM public.doctor_booking_slots(ca.doctor_service,ca.appointment_date) slot WHERE slot=ca.appointment_time)
 THEN 'Outside current doctor availability — review or reschedule'::text ELSE NULL::text END AS conflict_reason
 ) dav ON (true));

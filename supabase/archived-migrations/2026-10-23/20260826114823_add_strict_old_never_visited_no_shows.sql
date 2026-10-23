CREATE OR REPLACE FUNCTION public.populate_outgoing_call_queue(p_date date DEFAULT ((now() AT TIME ZONE 'Asia/Dhaka'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_agent text := public.get_scheduled_agent(p_date);
  v_no_show int := 0;
  v_old_never_visited int := 0;
  v_missed_followup int := 0;
  v_surgery int := 0;
  v_healing int := 0;
  v_wound int := 0;
  v_screening int := 0;
  v_website int := 0;
  v_general int := 0;
  v_attempts_created int := 0;
BEGIN
  INSERT INTO public.outgoing_call_queue
    (patient_id, patient_name, phone, category, category_rank, reason, relevant_date, source_table, source_id, final_location, lead_type, lead_id, pinned_to_top)
  SELECT
    cl.patient_id, cl.lead_name, COALESCE(cl.phone_normalized, cl.phone),
    'website_appointment_made', 0,
    'Website appointment request' || CASE WHEN cl.main_problem IS NOT NULL THEN ' — ' || cl.main_problem ELSE '' END
      || CASE WHEN cl.preferred_doctor IS NOT NULL THEN ' (wants ' || cl.preferred_doctor || ')' ELSE '' END,
    COALESCE(cl.preferred_visit_date, cl.created_at::date),
    'crm_leads', cl.id::text, NULL, 'Website Appointment Request', cl.id, true
  FROM public.crm_leads cl
  WHERE cl.lead_status = 'Website Appointment Made'
    AND NOT EXISTS (
      SELECT 1 FROM public.outgoing_call_queue q
      WHERE q.category = 'website_appointment_made'
        AND q.source_table = 'crm_leads'
        AND q.source_id = cl.id::text
    );
  GET DIAGNOSTICS v_website = ROW_COUNT;

  -- True no-shows: patient has NEVER had a prior invoice-validated Completed
  -- appointment before this one. These are the top priority in the whole
  -- queue (ranks 1-3) — someone who has never once been seen.
  -- Include all patients after 96 hours, or immediately when
  -- appointment_status is explicitly changed to No-show.
  INSERT INTO public.outgoing_call_queue
    (patient_id, patient_name, phone, category, category_rank, reason, relevant_date, source_table, source_id, final_location, lead_type)
  SELECT
    r.resolved_patient_id,
    COALESCE(p.full_name, r.lead_name),
    COALESCE(p.phone_e164, r.phone_normalized, r.lead_phone),
    CASE WHEN (p_date - va.appointment_date) <= 7  THEN 'no_show_7'
         WHEN (p_date - va.appointment_date) <= 14 THEN 'no_show_14'
         ELSE 'no_show_28' END,
    CASE WHEN (p_date - va.appointment_date) <= 7  THEN 1
         WHEN (p_date - va.appointment_date) <= 14 THEN 2
         ELSE 3 END,
    'No-show on ' || va.appointment_date::text || ' with ' || COALESCE(va.doctor_service,'doctor') || ' — never visited before',
    va.appointment_date, 'validated_appointments', va.appointment_id::text,
    p.area, 'Follow-up (No-show)'
  FROM public.validated_appointments va
  JOIN public.appointment_patient_resolution r ON r.appointment_id = va.appointment_id
  LEFT JOIN public.patients p ON p.id = r.resolved_patient_id
  WHERE va.validated_status = 'No-show'
    AND va.appointment_date >= p_date - 28
    AND va.appointment_date <= p_date
    AND (va.appointment_date <= p_date - 4 OR va.appointment_status = 'No-show')
    AND NOT EXISTS (
      SELECT 1 FROM public.validated_appointments prior
      WHERE prior.resolved_patient_id = r.resolved_patient_id
        AND prior.validated_status = 'Completed'
        AND prior.appointment_date < va.appointment_date
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.outgoing_call_queue q
      WHERE q.category IN ('no_show_7','no_show_14','no_show_28','missed_followup_7','missed_followup_14','missed_followup_28')
        AND q.source_table = 'validated_appointments'
        AND q.source_id = va.appointment_id::text
    );
  GET DIAGNOSTICS v_no_show = ROW_COUNT;

  -- Older no-shows (29-120 days): one reactivation per strictly
  -- never-visited patient. Require resolved identity and no evidence of a
  -- completed visit in validated appointments, CRM appointments, or admissions.
  -- Also honor opt-outs / agent-confirmed visits and avoid active duplicates.
  WITH old_never_visited_candidates AS (
    SELECT DISTINCT ON (r.resolved_patient_id)
      va.appointment_id,
      va.appointment_date,
      r.resolved_patient_id,
      COALESCE(p.full_name, r.lead_name) AS patient_name,
      COALESCE(p.phone_e164, r.phone_normalized, r.lead_phone) AS phone,
      p.area AS final_location,
      va.doctor_service
    FROM public.validated_appointments va
    JOIN public.appointment_patient_resolution r ON r.appointment_id = va.appointment_id
    LEFT JOIN public.patients p ON p.id = r.resolved_patient_id
    WHERE va.validated_status = 'No-show'
      AND va.appointment_date BETWEEN p_date - 120 AND p_date - 29
      AND r.resolved_patient_id IS NOT NULL
      AND public.outgoing_queue_normalized_phone(COALESCE(p.phone_e164, r.phone_normalized, r.lead_phone)) IS NOT NULL
      AND length(public.outgoing_queue_normalized_phone(COALESCE(p.phone_e164, r.phone_normalized, r.lead_phone))) >= 10
      AND NOT EXISTS (
        SELECT 1 FROM public.validated_appointments completed
        WHERE completed.resolved_patient_id = r.resolved_patient_id
          AND completed.validated_status = 'Completed'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.crm_appointments ap
        WHERE ap.patient_id = r.resolved_patient_id
          AND ap.appointment_status = 'Completed'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.admissions adm
        WHERE adm.patient_id = r.resolved_patient_id
          AND adm.status <> 'Cancelled'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.crm_appointments future_appt
        WHERE future_appt.patient_id = r.resolved_patient_id
          AND future_appt.appointment_date >= p_date
          AND future_appt.appointment_status <> 'Cancelled'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.outgoing_call_attempts prior_attempt
        JOIN public.outgoing_call_queue prior_queue ON prior_queue.id = prior_attempt.queue_id
        WHERE (
            prior_queue.patient_id = r.resolved_patient_id
            OR public.outgoing_queue_normalized_phone(prior_queue.phone)
               = public.outgoing_queue_normalized_phone(COALESCE(p.phone_e164, r.phone_normalized, r.lead_phone))
          )
          AND prior_attempt.outcome_code IN ('do_not_call','not_interested','wrong_number','already_visited')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.outgoing_call_queue active_queue
        WHERE active_queue.status = 'open'
          AND (
            active_queue.patient_id = r.resolved_patient_id
            OR public.outgoing_queue_normalized_phone(active_queue.phone)
               = public.outgoing_queue_normalized_phone(COALESCE(p.phone_e164, r.phone_normalized, r.lead_phone))
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.outgoing_call_queue prior_old_reactivation
        WHERE prior_old_reactivation.patient_id = r.resolved_patient_id
          AND prior_old_reactivation.lead_type = 'Follow-up (Old No-show)'
      )
    ORDER BY r.resolved_patient_id, va.appointment_date DESC, va.appointment_id DESC
  )
  INSERT INTO public.outgoing_call_queue
    (patient_id, patient_name, phone, category, category_rank, reason,
     relevant_date, source_table, source_id, final_location, lead_type)
  SELECT
    c.resolved_patient_id,
    c.patient_name,
    c.phone,
    'no_show_28',
    3,
    'Older no-show on ' || c.appointment_date::text || ' with '
      || COALESCE(c.doctor_service,'doctor')
      || ' — never visited; no completed appointment or admission found',
    c.appointment_date,
    'validated_appointments',
    c.appointment_id::text,
    c.final_location,
    'Follow-up (Old No-show)'
  FROM old_never_visited_candidates c;
  GET DIAGNOSTICS v_old_never_visited = ROW_COUNT;

  -- Missed follow-ups: patient HAS visited before (an invoice-validated
  -- Completed appointment predates this no-show) — this is a lapsed
  -- follow-up, not a never-seen patient. Ranked below Surgery, above
  -- Wound/Screening lead-gen categories.
  INSERT INTO public.outgoing_call_queue
    (patient_id, patient_name, phone, category, category_rank, reason, relevant_date, source_table, source_id, final_location, lead_type)
  SELECT
    r.resolved_patient_id,
    COALESCE(p.full_name, r.lead_name),
    COALESCE(p.phone_e164, r.phone_normalized, r.lead_phone),
    CASE WHEN (p_date - va.appointment_date) <= 7  THEN 'missed_followup_7'
         WHEN (p_date - va.appointment_date) <= 14 THEN 'missed_followup_14'
         ELSE 'missed_followup_28' END,
    CASE WHEN (p_date - va.appointment_date) <= 7  THEN 5
         WHEN (p_date - va.appointment_date) <= 14 THEN 6
         ELSE 7 END,
    'Missed follow-up on ' || va.appointment_date::text || ' with ' || COALESCE(va.doctor_service,'doctor') || ' — has visited before',
    va.appointment_date, 'validated_appointments', va.appointment_id::text,
    p.area, 'Follow-up (Missed)'
  FROM public.validated_appointments va
  JOIN public.appointment_patient_resolution r ON r.appointment_id = va.appointment_id
  LEFT JOIN public.patients p ON p.id = r.resolved_patient_id
  WHERE va.validated_status = 'No-show'
    AND va.appointment_date >= p_date - 28
    AND va.appointment_date <= p_date
    AND (va.appointment_date <= p_date - 4 OR va.appointment_status = 'No-show')
    AND EXISTS (
      SELECT 1 FROM public.validated_appointments prior
      WHERE prior.resolved_patient_id = r.resolved_patient_id
        AND prior.validated_status = 'Completed'
        AND prior.appointment_date < va.appointment_date
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.outgoing_call_queue q
      WHERE q.category IN ('no_show_7','no_show_14','no_show_28','missed_followup_7','missed_followup_14','missed_followup_28')
        AND q.source_table = 'validated_appointments'
        AND q.source_id = va.appointment_id::text
    );
  GET DIAGNOSTICS v_missed_followup = ROW_COUNT;

  INSERT INTO public.outgoing_call_queue
    (patient_id, patient_name, phone, category, category_rank, reason, relevant_date, source_table, source_id, final_location, lead_type)
  SELECT p.id, p.full_name, p.phone_e164, 'surgery_no_show', 4,
    'Tagged for surgery on ' || COALESCE(p.surgery_flagged_at::text,'unknown date') || ', no admission since',
    COALESCE(p.surgery_flagged_at, p_date), 'patients', p.id::text, p.area, 'Surgery'
  FROM public.patients p
  WHERE p.surgery_scheduled = true
    AND NOT EXISTS (SELECT 1 FROM public.admissions a WHERE a.patient_id = p.id AND a.admitted_on >= p_date - 14)
    AND NOT EXISTS (SELECT 1 FROM public.outgoing_call_queue q WHERE q.category = 'surgery_no_show' AND q.patient_id = p.id AND q.status = 'open');
  GET DIAGNOSTICS v_surgery = ROW_COUNT;

  INSERT INTO public.outgoing_call_queue
    (patient_id, patient_name, phone, category, category_rank, reason, relevant_date, source_table, source_id, final_location, lead_type, lead_id)
  SELECT cl.patient_id, cl.lead_name, COALESCE(cl.phone_normalized, cl.phone),
    CASE WHEN (p_date - cl.created_at::date) <= 7  THEN 'wound_no_appt_7'
         WHEN (p_date - cl.created_at::date) <= 14 THEN 'wound_no_appt_14'
         WHEN (p_date - cl.created_at::date) <= 28 THEN 'wound_no_appt_28'
         ELSE 'wound_no_appt_old' END,
    CASE WHEN (p_date - cl.created_at::date) <= 7  THEN 8
         WHEN (p_date - cl.created_at::date) <= 14 THEN 9
         WHEN (p_date - cl.created_at::date) <= 28 THEN 10
         ELSE 11 END,
    'Wound Care lead, called in ' || to_char(cl.created_at::date,'DD Mon YYYY') || ' — no appointment booked',
    cl.created_at::date, 'crm_leads', cl.id::text, NULL, 'Wound Care Assessment', cl.id
  FROM public.crm_leads cl
  WHERE (cl.campaign_name ILIKE '%wound%' OR cl.lead_bucket ILIKE '%wound%')
    AND cl.lead_status ILIKE 'no appointment%'
    AND NOT EXISTS (SELECT 1 FROM public.outgoing_call_queue q WHERE q.category IN ('wound_no_appt_7','wound_no_appt_14','wound_no_appt_28','wound_no_appt_old') AND q.source_table = 'crm_leads' AND q.source_id = cl.id::text);
  GET DIAGNOSTICS v_wound = ROW_COUNT;

  INSERT INTO public.outgoing_call_queue
    (patient_id, patient_name, phone, category, category_rank, reason, relevant_date, source_table, source_id, final_location, lead_type, lead_id)
  SELECT cl.patient_id, cl.lead_name, COALESCE(cl.phone_normalized, cl.phone),
    CASE WHEN (p_date - cl.created_at::date) <= 7  THEN 'screening_no_appt_7'
         WHEN (p_date - cl.created_at::date) <= 14 THEN 'screening_no_appt_14'
         WHEN (p_date - cl.created_at::date) <= 28 THEN 'screening_no_appt_28'
         ELSE 'screening_no_appt_old' END,
    CASE WHEN (p_date - cl.created_at::date) <= 7  THEN 12
         WHEN (p_date - cl.created_at::date) <= 14 THEN 13
         WHEN (p_date - cl.created_at::date) <= 28 THEN 14
         ELSE 15 END,
    'Screening lead, called in ' || to_char(cl.created_at::date,'DD Mon YYYY') || ' — no appointment booked',
    cl.created_at::date, 'crm_leads', cl.id::text, NULL, 'Diabetic Foot Screening', cl.id
  FROM public.crm_leads cl
  WHERE (cl.campaign_name ILIKE '%screen%' OR cl.lead_bucket ILIKE '%screen%')
    AND cl.lead_status ILIKE 'no appointment%'
    AND NOT EXISTS (SELECT 1 FROM public.outgoing_call_queue q WHERE q.category IN ('screening_no_appt_7','screening_no_appt_14','screening_no_appt_28','screening_no_appt_old') AND q.source_table = 'crm_leads' AND q.source_id = cl.id::text);
  GET DIAGNOSTICS v_screening = ROW_COUNT;

  INSERT INTO public.outgoing_call_queue
    (patient_id, patient_name, phone, category, category_rank, reason, relevant_date, source_table, source_id, final_location, lead_type)
  SELECT p.id, p.full_name, p.phone_e164,
    CASE WHEN (p_date - lv.last_admitted::date) <= 28 THEN 'healing_overdue_4w'
         WHEN (p_date - lv.last_admitted::date) <= 56 THEN 'healing_overdue_8w'
         ELSE 'healing_overdue_old' END,
    CASE WHEN (p_date - lv.last_admitted::date) <= 28 THEN 16
         WHEN (p_date - lv.last_admitted::date) <= 56 THEN 17
         ELSE 18 END,
    'Not marked healed, last visit ' || lv.last_admitted::text,
    lv.last_admitted::date, 'patients', p.id::text, p.area, 'Healing Follow-up'
  FROM public.patients p
  JOIN LATERAL (SELECT max(a.admitted_on) AS last_admitted FROM public.admissions a WHERE a.patient_id = p.id) lv ON lv.last_admitted IS NOT NULL
  WHERE false
    AND (p.healing_status IS NULL OR lower(p.healing_status) NOT IN ('healed','closed'))
    AND lv.last_admitted::date <= p_date - 14 AND lv.last_admitted::date >= p_date - 120
    AND NOT EXISTS (SELECT 1 FROM public.crm_appointments ap WHERE ap.patient_id = p.id AND ap.appointment_date >= p_date AND ap.appointment_status NOT IN ('Cancelled'))
    AND NOT EXISTS (SELECT 1 FROM public.admissions a WHERE a.patient_id = p.id AND a.admitted_on >= p_date)
    AND NOT EXISTS (SELECT 1 FROM public.outgoing_call_queue q WHERE q.category IN ('healing_overdue_4w','healing_overdue_8w','healing_overdue_old') AND q.patient_id = p.id AND q.status = 'open');
  GET DIAGNOSTICS v_healing = ROW_COUNT;

  -- General no-appointment leads: all remaining no-appointment CRM leads.
  INSERT INTO public.outgoing_call_queue
    (patient_id, patient_name, phone, category, category_rank, reason, relevant_date, source_table, source_id, final_location, lead_type, lead_id)
  SELECT cl.patient_id, cl.lead_name, COALESCE(cl.phone_normalized, cl.phone),
    'general_no_appt', 19,
    'CRM lead with no appointment, called in ' || to_char(cl.created_at::date,'DD Mon YYYY') || ' — no appointment booked',
    cl.created_at::date, 'crm_leads', cl.id::text, NULL, 'General Lead', cl.id
  FROM public.crm_leads cl
  WHERE cl.lead_status ILIKE 'no appointment%'
    AND (COALESCE(cl.campaign_name, '') NOT ILIKE '%wound%' AND COALESCE(cl.lead_bucket, '') NOT ILIKE '%wound%')
    AND (COALESCE(cl.campaign_name, '') NOT ILIKE '%screen%' AND COALESCE(cl.lead_bucket, '') NOT ILIKE '%screen%')
    AND NOT EXISTS (
      SELECT 1 FROM public.outgoing_call_queue q
      WHERE q.category = 'general_no_appt'
        AND q.source_table = 'crm_leads'
        AND q.source_id = cl.id::text
    );
  GET DIAGNOSTICS v_general = ROW_COUNT;

  INSERT INTO public.outgoing_call_attempts (queue_id, followup_number, scheduled_date, assigned_agent, status)
  SELECT q.id, 1, p_date, v_agent, 'pending'
  FROM public.outgoing_call_queue q
  WHERE q.status = 'open'
    AND NOT EXISTS (SELECT 1 FROM public.outgoing_call_attempts a WHERE a.queue_id = q.id);
  GET DIAGNOSTICS v_attempts_created = ROW_COUNT;

  RETURN jsonb_build_object(
    'date', p_date, 'agent_on_duty', v_agent,
    'website_appointment_added', v_website,
    'no_show_added', v_no_show, 'old_never_visited_no_show_added', v_old_never_visited, 'missed_followup_added', v_missed_followup,
    'surgery_no_show_added', v_surgery,
    'healing_overdue_added', v_healing,
    'wound_added', v_wound, 'screening_added', v_screening,
    'general_added', v_general,
    'first_attempts_created', v_attempts_created
  );
END;
$function$;


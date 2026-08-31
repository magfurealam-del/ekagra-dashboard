ALTER TABLE public.outgoing_call_queue
  ADD COLUMN IF NOT EXISTS doctor_service text,
  ADD COLUMN IF NOT EXISTS booking_main_problem text,
  ADD COLUMN IF NOT EXISTS booking_preferred_visit_date date,
  ADD COLUMN IF NOT EXISTS booking_lead_status text,
  ADD COLUMN IF NOT EXISTS booking_urgency text,
  ADD COLUMN IF NOT EXISTS booking_notes text;

UPDATE public.outgoing_call_queue q
SET doctor_service = NULLIF(btrim(cl.preferred_doctor), ''),
    booking_main_problem = cl.main_problem,
    booking_preferred_visit_date = cl.preferred_visit_date,
    booking_lead_status = cl.lead_status,
    booking_urgency = cl.urgency,
    booking_notes = cl.notes
FROM public.crm_leads cl
WHERE q.category = 'website_appointment_made'
  AND q.lead_id = cl.id;

CREATE OR REPLACE FUNCTION public.sync_website_queue_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.category = 'website_appointment_made' AND NEW.lead_id IS NOT NULL THEN
    SELECT NULLIF(btrim(cl.preferred_doctor), ''), cl.main_problem,
           cl.preferred_visit_date, cl.lead_status, cl.urgency, cl.notes
      INTO NEW.doctor_service, NEW.booking_main_problem,
           NEW.booking_preferred_visit_date, NEW.booking_lead_status,
           NEW.booking_urgency, NEW.booking_notes
    FROM public.crm_leads cl
    WHERE cl.id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_website_queue_context ON public.outgoing_call_queue;
CREATE TRIGGER trg_sync_website_queue_context
BEFORE INSERT OR UPDATE OF category, lead_id ON public.outgoing_call_queue
FOR EACH ROW EXECUTE FUNCTION public.sync_website_queue_context();

CREATE OR REPLACE VIEW public.outgoing_call_sheet_view AS
WITH candidates AS (
  SELECT a.id AS attempt_id, a.queue_id, a.followup_number, a.scheduled_date,
    a.assigned_agent, a.status AS attempt_status, a.outcome, a.outcome_code,
    a.notes AS attempt_notes, a.called_at, a.callback_at,
    q.patient_id, q.patient_name, q.phone, q.final_location, q.lead_type,
    q.category, q.category_rank, q.reason, q.relevant_date,
    q.created_at AS queue_created_at, q.max_followups, q.followups_done,
    q.status AS queue_status, q.pinned_to_top, q.no_show_risk,
    q.doctor_service, q.booking_main_problem, q.booking_preferred_visit_date,
    q.booking_lead_status, q.booking_urgency, q.booking_notes,
    CASE WHEN q.patient_id IS NOT NULL THEN 1.000
         WHEN q.phone IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.patients p
           WHERE public.outgoing_queue_normalized_phone(p.phone_e164) = public.outgoing_queue_normalized_phone(q.phone)
              OR public.outgoing_queue_normalized_phone(p.phone) = public.outgoing_queue_normalized_phone(q.phone)
         ) THEN 0.800 ELSE 0.400 END AS confidence_score,
    CASE WHEN q.patient_id IS NOT NULL THEN 'verified_patient'::text
         WHEN q.phone IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.patients p
           WHERE public.outgoing_queue_normalized_phone(p.phone_e164) = public.outgoing_queue_normalized_phone(q.phone)
              OR public.outgoing_queue_normalized_phone(p.phone) = public.outgoing_queue_normalized_phone(q.phone)
         ) THEN 'phone_matched'::text ELSE 'unmatched'::text END AS confidence_label,
    a.scheduled_date < (now() AT TIME ZONE 'Asia/Dhaka')::date AND a.status = 'pending'::text AS is_overdue,
    row_number() OVER (PARTITION BY COALESCE('p:'::text || q.patient_id::text, 'ph:'::text || public.outgoing_queue_normalized_phone(q.phone))
      ORDER BY q.pinned_to_top DESC, q.category_rank, q.relevant_date, q.created_at) AS dedupe_rank
  FROM public.outgoing_call_attempts a
  JOIN public.outgoing_call_queue q ON q.id = a.queue_id
  WHERE q.status = 'open'::text AND NOT public.outgoing_queue_is_recently_visited(q.id)
)
SELECT attempt_id, queue_id, followup_number, scheduled_date, assigned_agent,
  attempt_status, outcome, outcome_code, attempt_notes, called_at, callback_at,
  patient_id, patient_name, phone, final_location, lead_type, category,
  category_rank, reason, relevant_date, queue_created_at, max_followups,
  followups_done, queue_status, pinned_to_top, no_show_risk, confidence_score,
  confidence_label, is_overdue, doctor_service, booking_main_problem,
  booking_preferred_visit_date, booking_lead_status, booking_urgency, booking_notes
FROM candidates
WHERE dedupe_rank = 1
ORDER BY pinned_to_top DESC, confidence_score DESC, category_rank, relevant_date;

UPDATE public.outgoing_call_queue q
SET status = 'open', updated_at = now()
FROM public.crm_leads cl
WHERE q.category = 'website_appointment_made'
  AND q.lead_id = cl.id
  AND q.status <> 'open'
  AND cl.lead_status = 'Website Appointment Made'
  AND NOT EXISTS (
    SELECT 1 FROM public.crm_appointments a
    WHERE a.lead_id = cl.id
      AND lower(coalesce(a.appointment_status, '')) IN ('completed', 'appointment done')
  );

INSERT INTO public.outgoing_call_attempts (queue_id, followup_number, scheduled_date, assigned_agent, status)
SELECT q.id, 1, COALESCE(q.relevant_date, (now() AT TIME ZONE 'Asia/Dhaka')::date),
       COALESCE(public.get_scheduled_agent((now() AT TIME ZONE 'Asia/Dhaka')::date), 'Unassigned'), 'pending'
FROM public.outgoing_call_queue q
WHERE q.category = 'website_appointment_made'
  AND q.status = 'open'
  AND NOT EXISTS (
    SELECT 1 FROM public.outgoing_call_attempts a
    WHERE a.queue_id = q.id AND a.status = 'pending'
  )
ON CONFLICT (queue_id, followup_number) DO NOTHING;

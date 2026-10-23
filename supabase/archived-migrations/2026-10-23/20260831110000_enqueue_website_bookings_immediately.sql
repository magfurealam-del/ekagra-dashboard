CREATE OR REPLACE FUNCTION public.enqueue_website_booking_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queue_id bigint;
  assigned_agent text := COALESCE(public.get_scheduled_agent((now() AT TIME ZONE 'Asia/Dhaka')::date), 'Unassigned');
BEGIN
  IF NEW.source_system = 'website' AND NEW.lead_status = 'Website Appointment Made' THEN
    INSERT INTO public.outgoing_call_queue
      (patient_id, patient_name, phone, category, category_rank, reason, relevant_date,
       source_table, source_id, final_location, lead_type, lead_id, pinned_to_top)
    SELECT NEW.patient_id, NEW.lead_name, COALESCE(NEW.phone_normalized, NEW.phone),
      'website_appointment_made', 0,
      'Website appointment request' || CASE WHEN NEW.main_problem IS NOT NULL THEN ' — ' || NEW.main_problem ELSE '' END
        || CASE WHEN NEW.preferred_doctor IS NOT NULL THEN ' (wants ' || NEW.preferred_doctor || ')' ELSE '' END,
      COALESCE(NEW.preferred_visit_date, NEW.created_at::date), 'crm_leads', NEW.id::text,
      NULL, 'Website Appointment Request', NEW.id, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.outgoing_call_queue q
      WHERE q.category = 'website_appointment_made' AND q.source_table = 'crm_leads'
        AND q.source_id = NEW.id::text AND q.status = 'open'
    )
    RETURNING id INTO queue_id;

    IF queue_id IS NULL THEN
      SELECT q.id INTO queue_id
      FROM public.outgoing_call_queue q
      WHERE q.category = 'website_appointment_made' AND q.lead_id = NEW.id AND q.status = 'open'
      ORDER BY q.updated_at DESC LIMIT 1;
    END IF;

    IF queue_id IS NOT NULL THEN
      INSERT INTO public.outgoing_call_attempts
        (queue_id, followup_number, scheduled_date, assigned_agent, status)
      SELECT queue_id, q.followups_done + 1,
        COALESCE(q.relevant_date, (now() AT TIME ZONE 'Asia/Dhaka')::date), assigned_agent, 'pending'
      FROM public.outgoing_call_queue q
      WHERE q.id = queue_id AND q.followups_done < q.max_followups
        AND NOT EXISTS (SELECT 1 FROM public.outgoing_call_attempts a WHERE a.queue_id = queue_id AND a.status = 'pending')
      ON CONFLICT (queue_id, followup_number) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_website_booking_lead ON public.crm_leads;
CREATE TRIGGER trg_enqueue_website_booking_lead
AFTER INSERT OR UPDATE OF lead_status, preferred_doctor, preferred_visit_date, main_problem, phone ON public.crm_leads
FOR EACH ROW EXECUTE FUNCTION public.enqueue_website_booking_lead();

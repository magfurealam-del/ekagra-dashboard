-- A new website appointment request is a new event, even when its phone
-- matches an older queue item. Keep the newest request visible and retire
-- the stale queue work so agents see the latest doctor, problem, and date.

CREATE OR REPLACE FUNCTION public.promote_website_booking_queue(p_queue_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_patient_id integer;
  v_phone text;
BEGIN
  SELECT q.patient_id, public.outgoing_queue_normalized_phone(q.phone)
    INTO STRICT v_patient_id, v_phone
  FROM public.outgoing_call_queue AS q
  WHERE q.id = p_queue_id
    AND q.category = 'website_appointment_made';

  -- Serialize competing website submissions for the same patient/phone.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'website-booking:' || COALESCE(v_patient_id::text, v_phone, p_queue_id::text),
      0
    )
  );

  -- A retired queue must not retain actionable pending attempts.
  UPDATE public.outgoing_call_attempts AS a
  SET status = 'skipped',
      notes = concat_ws(
        E'\n',
        NULLIF(a.notes, ''),
        'Automatically skipped: superseded by a newer website appointment request.'
      )
  FROM public.outgoing_call_queue AS q
  WHERE a.queue_id = q.id
    AND a.status = 'pending'
    AND q.id <> p_queue_id
    AND q.status = 'open'
    AND (
      (v_patient_id IS NOT NULL AND q.patient_id = v_patient_id)
      OR (
        v_phone IS NOT NULL
        AND public.outgoing_queue_normalized_phone(q.phone) = v_phone
      )
    );

  UPDATE public.outgoing_call_queue AS q
  SET status = 'removed',
      suppression_reason = 'superseded by newer website appointment request',
      updated_at = now()
  WHERE q.id <> p_queue_id
    AND q.status = 'open'
    AND (
      (v_patient_id IS NOT NULL AND q.patient_id = v_patient_id)
      OR (
        v_phone IS NOT NULL
        AND public.outgoing_queue_normalized_phone(q.phone) = v_phone
      )
    );

  -- Website requests are callable immediately. The requested visit date is
  -- retained separately and must not delay appearance in today's call sheet.
  UPDATE public.outgoing_call_queue AS q
  SET patient_id = l.patient_id,
      patient_name = l.lead_name,
      phone = COALESCE(NULLIF(l.phone_normalized, ''), l.phone),
      reason = 'Website appointment request'
        || CASE
          WHEN NULLIF(btrim(l.main_problem), '') IS NOT NULL
            THEN ' — ' || btrim(l.main_problem)
          ELSE ''
        END
        || CASE
          WHEN NULLIF(btrim(l.preferred_doctor), '') IS NOT NULL
            THEN ' (wants ' || btrim(l.preferred_doctor) || ')'
          ELSE ''
        END,
      relevant_date = COALESCE(
        (l.created_at AT TIME ZONE 'Asia/Dhaka')::date,
        (now() AT TIME ZONE 'Asia/Dhaka')::date
      ),
      source_table = 'crm_leads',
      source_id = l.id::text,
      final_location = NULL,
      lead_type = 'Website Appointment Request',
      lead_id = l.id,
      category = 'website_appointment_made',
      category_rank = 0,
      pinned_to_top = true,
      status = 'open',
      suppression_reason = NULL,
      doctor_service = NULLIF(btrim(l.preferred_doctor), ''),
      booking_main_problem = l.main_problem,
      booking_preferred_visit_date = l.preferred_visit_date,
      booking_lead_status = l.lead_status,
      booking_urgency = l.urgency,
      booking_notes = l.notes,
      updated_at = now()
  FROM public.crm_leads AS l
  WHERE q.id = p_queue_id
    AND l.id = q.lead_id;

  INSERT INTO public.outgoing_call_attempts
    (queue_id, followup_number, scheduled_date, assigned_agent, status)
  SELECT q.id,
         next_attempt.followup_number,
         (now() AT TIME ZONE 'Asia/Dhaka')::date,
         COALESCE(
           public.get_scheduled_agent((now() AT TIME ZONE 'Asia/Dhaka')::date),
           'Unassigned'
         ),
         'pending'
  FROM public.outgoing_call_queue AS q
  CROSS JOIN LATERAL (
    SELECT candidate.followup_number
    FROM generate_series(1, q.max_followups) AS candidate(followup_number)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.outgoing_call_attempts AS existing_attempt
      WHERE existing_attempt.queue_id = q.id
        AND existing_attempt.followup_number = candidate.followup_number
    )
    ORDER BY candidate.followup_number
    LIMIT 1
  ) AS next_attempt
  WHERE q.id = p_queue_id
    AND q.status = 'open'
    AND NOT EXISTS (
      SELECT 1
      FROM public.outgoing_call_attempts AS pending_attempt
      WHERE pending_attempt.queue_id = q.id
        AND pending_attempt.status = 'pending'
    )
  ON CONFLICT (queue_id, followup_number) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.outgoing_queue_insert_quality_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.category = 'website_appointment_made' THEN
    PERFORM public.promote_website_booking_queue(NEW.id);
    RETURN NEW;
  END IF;

  IF public.outgoing_queue_is_recently_visited(NEW.id) THEN
    UPDATE public.outgoing_call_queue
    SET status = 'removed',
        suppression_reason = 'patient visited after source event',
        updated_at = now()
    WHERE id = NEW.id;
  ELSIF EXISTS (
    SELECT 1
    FROM public.outgoing_call_queue AS q
    WHERE q.status = 'open'
      AND q.id <> NEW.id
      AND (
        (NEW.patient_id IS NOT NULL AND q.patient_id = NEW.patient_id)
        OR (
          NEW.patient_id IS NULL
          AND NEW.phone IS NOT NULL
          AND public.outgoing_queue_normalized_phone(q.phone)
            = public.outgoing_queue_normalized_phone(NEW.phone)
        )
      )
  ) THEN
    UPDATE public.outgoing_call_queue
    SET status = 'removed',
        suppression_reason = 'duplicate patient or phone; existing queue item retained',
        updated_at = now()
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_website_booking_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_queue_id bigint;
BEGIN
  IF NEW.source_system IS DISTINCT FROM 'website'
     OR NEW.lead_status IS DISTINCT FROM 'Website Appointment Made' THEN
    RETURN NEW;
  END IF;

  SELECT q.id
    INTO v_queue_id
  FROM public.outgoing_call_queue AS q
  WHERE q.category = 'website_appointment_made'
    AND q.source_table = 'crm_leads'
    AND q.source_id = NEW.id::text
    AND q.status = 'open'
  ORDER BY q.updated_at DESC, q.id DESC
  LIMIT 1;

  IF v_queue_id IS NOT NULL THEN
    UPDATE public.outgoing_call_queue AS q
    SET patient_id = NEW.patient_id,
        patient_name = NEW.lead_name,
        phone = COALESCE(NULLIF(NEW.phone_normalized, ''), NEW.phone),
        reason = 'Website appointment request'
          || CASE
            WHEN NULLIF(btrim(NEW.main_problem), '') IS NOT NULL
              THEN ' — ' || btrim(NEW.main_problem)
            ELSE ''
          END
          || CASE
            WHEN NULLIF(btrim(NEW.preferred_doctor), '') IS NOT NULL
              THEN ' (wants ' || btrim(NEW.preferred_doctor) || ')'
            ELSE ''
          END,
        relevant_date = COALESCE(
          (NEW.created_at AT TIME ZONE 'Asia/Dhaka')::date,
          (now() AT TIME ZONE 'Asia/Dhaka')::date
        ),
        source_id = NEW.id::text,
        lead_id = NEW.id,
        category = 'website_appointment_made',
        category_rank = 0,
        pinned_to_top = true,
        doctor_service = NULLIF(btrim(NEW.preferred_doctor), ''),
        booking_main_problem = NEW.main_problem,
        booking_preferred_visit_date = NEW.preferred_visit_date,
        booking_lead_status = NEW.lead_status,
        booking_urgency = NEW.urgency,
        booking_notes = NEW.notes,
        updated_at = now()
    WHERE q.id = v_queue_id;

    PERFORM public.promote_website_booking_queue(v_queue_id);
    RETURN NEW;
  END IF;

  -- Do not recreate a completed/removed request merely because an old lead
  -- was edited. A transition into Website Appointment Made is a new event.
  IF TG_OP = 'UPDATE' AND OLD.lead_status = 'Website Appointment Made' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.outgoing_call_queue
    (patient_id, patient_name, phone, category, category_rank, reason,
     relevant_date, source_table, source_id, final_location, lead_type,
     lead_id, pinned_to_top, doctor_service, booking_main_problem,
     booking_preferred_visit_date, booking_lead_status, booking_urgency,
     booking_notes)
  VALUES (
    NEW.patient_id,
    NEW.lead_name,
    COALESCE(NULLIF(NEW.phone_normalized, ''), NEW.phone),
    'website_appointment_made',
    0,
    'Website appointment request'
      || CASE
        WHEN NULLIF(btrim(NEW.main_problem), '') IS NOT NULL
          THEN ' — ' || btrim(NEW.main_problem)
        ELSE ''
      END
      || CASE
        WHEN NULLIF(btrim(NEW.preferred_doctor), '') IS NOT NULL
          THEN ' (wants ' || btrim(NEW.preferred_doctor) || ')'
        ELSE ''
      END,
    COALESCE(
      (NEW.created_at AT TIME ZONE 'Asia/Dhaka')::date,
      (now() AT TIME ZONE 'Asia/Dhaka')::date
    ),
    'crm_leads',
    NEW.id::text,
    NULL,
    'Website Appointment Request',
    NEW.id,
    true,
    NULLIF(btrim(NEW.preferred_doctor), ''),
    NEW.main_problem,
    NEW.preferred_visit_date,
    NEW.lead_status,
    NEW.urgency,
    NEW.notes
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_website_booking_lead ON public.crm_leads;
CREATE TRIGGER trg_enqueue_website_booking_lead
AFTER INSERT OR UPDATE OF
  source_system,
  lead_status,
  preferred_doctor,
  preferred_visit_date,
  main_problem,
  phone,
  phone_normalized,
  lead_name,
  patient_id,
  urgency,
  notes
ON public.crm_leads
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_website_booking_lead();

-- Repair website requests suppressed after the trigger fix. This promotes
-- the newest request and retires any stale same-patient/phone queue work.
DO $$
DECLARE
  v_queue_id bigint;
BEGIN
  FOR v_queue_id IN
    SELECT q.id
    FROM public.outgoing_call_queue AS q
    JOIN public.crm_leads AS l ON l.id = q.lead_id
    WHERE q.category = 'website_appointment_made'
      AND q.status = 'removed'
      AND q.suppression_reason = 'duplicate patient or phone; existing queue item retained'
      AND l.source_system = 'website'
      AND l.lead_status = 'Website Appointment Made'
      AND l.created_at >= timestamptz '2026-09-05 11:40:38+00'
    ORDER BY l.created_at, q.id
  LOOP
    PERFORM public.promote_website_booking_queue(v_queue_id);
  END LOOP;
END;
$$;

-- These are internal trigger helpers, not public RPC endpoints.
REVOKE EXECUTE ON FUNCTION public.promote_website_booking_queue(bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_website_booking_lead()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.outgoing_queue_insert_quality_trigger()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_website_queue_context()
  FROM PUBLIC, anon, authenticated;

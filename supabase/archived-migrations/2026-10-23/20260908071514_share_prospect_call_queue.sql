-- Prospect calls are shared work: any active staff member may take the next
-- available lead. Patient-recovery calls continue to use the daily schedule.

CREATE OR REPLACE FUNCTION public.outgoing_call_is_prospect_category(p_category text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(p_category = ANY (ARRAY[
    'website_appointment_made',
    'wound_no_appt_7',
    'wound_no_appt_14',
    'wound_no_appt_28',
    'wound_no_appt_old',
    'screening_no_appt_7',
    'screening_no_appt_14',
    'screening_no_appt_28',
    'screening_no_appt_old',
    'general_no_appt'
  ]::text[]), false);
$$;

CREATE OR REPLACE FUNCTION public.assign_shared_prospect_call_attempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.outgoing_call_queue AS q
    WHERE q.id = NEW.queue_id
      AND public.outgoing_call_is_prospect_category(q.category)
  ) THEN
    NEW.assigned_agent := 'Shared';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS outgoing_call_attempts_share_prospects
  ON public.outgoing_call_attempts;

CREATE TRIGGER outgoing_call_attempts_share_prospects
BEFORE INSERT ON public.outgoing_call_attempts
FOR EACH ROW
EXECUTE FUNCTION public.assign_shared_prospect_call_attempt();

REVOKE ALL ON FUNCTION public.assign_shared_prospect_call_attempt() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_shared_prospect_call_attempt() FROM anon, authenticated;

-- Release existing uncalled prospects from the old daily-agent assignment.
UPDATE public.outgoing_call_attempts AS a
SET assigned_agent = 'Shared'
FROM public.outgoing_call_queue AS q
WHERE q.id = a.queue_id
  AND a.status = 'pending'
  AND public.outgoing_call_is_prospect_category(q.category)
  AND a.assigned_agent IS DISTINCT FROM 'Shared';

CREATE OR REPLACE FUNCTION public.record_call_attempt_outcome(
  p_attempt_id bigint,
  p_outcome text,
  p_status text,
  p_notes text DEFAULT NULL::text,
  p_resolve boolean DEFAULT false,
  p_wait_days integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_queue_id bigint;
  v_followup_number smallint;
  v_max_followups smallint;
  v_prev_agent text;
  v_category text;
  v_next_date date;
  v_next_agent text;
  v_next_followup smallint;
  v_chained boolean := false;
  v_agent text := coalesce(public.current_agent_label(), 'agent');
BEGIN
  UPDATE public.outgoing_call_attempts
  SET status = p_status,
      outcome = p_outcome,
      notes = p_notes,
      called_at = now(),
      assigned_agent = v_agent
  WHERE id = p_attempt_id
    AND status = 'pending'
  RETURNING queue_id, followup_number, assigned_agent
  INTO v_queue_id, v_followup_number, v_prev_agent;

  IF v_queue_id IS NULL THEN
    RAISE EXCEPTION 'Call attempt not found or already actioned.';
  END IF;

  SELECT category INTO v_category
  FROM public.outgoing_call_queue
  WHERE id = v_queue_id;

  UPDATE public.outgoing_call_queue
  SET followups_done = GREATEST(followups_done, v_followup_number),
      updated_at = now()
  WHERE id = v_queue_id
  RETURNING max_followups INTO v_max_followups;

  v_next_followup := v_followup_number + 1;

  IF p_resolve OR p_status = 'skipped' THEN
    UPDATE public.outgoing_call_queue
    SET status = 'resolved', updated_at = now()
    WHERE id = v_queue_id;
  ELSIF v_next_followup > v_max_followups THEN
    UPDATE public.outgoing_call_queue
    SET status = 'exhausted', updated_at = now()
    WHERE id = v_queue_id;
  ELSE
    v_next_date := (now() AT TIME ZONE 'Asia/Dhaka')::date + p_wait_days;

    IF public.outgoing_call_is_prospect_category(v_category) THEN
      v_next_agent := 'Shared';
    ELSE
      v_next_agent := public.get_scheduled_agent(v_next_date);
      IF v_next_agent = v_prev_agent THEN
        v_next_date := v_next_date + 1;
        v_next_agent := public.get_scheduled_agent(v_next_date);
      END IF;
    END IF;

    INSERT INTO public.outgoing_call_attempts
      (queue_id, followup_number, scheduled_date, assigned_agent, status)
    VALUES
      (v_queue_id, v_next_followup, v_next_date, v_next_agent, 'pending');
    v_chained := true;
  END IF;

  RETURN jsonb_build_object(
    'queue_id', v_queue_id,
    'followup_number', v_followup_number,
    'next_attempt_chained', v_chained,
    'next_attempt_date', v_next_date,
    'next_attempt_agent', v_next_agent
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_call_attempt_outcome(
  p_attempt_id bigint,
  p_outcome text,
  p_status text,
  p_notes text DEFAULT NULL::text,
  p_resolve boolean DEFAULT false,
  p_wait_days integer DEFAULT 3,
  p_outcome_code text DEFAULT NULL::text,
  p_agent_name text DEFAULT NULL::text,
  p_callback_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_confirmed boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_queue_id bigint;
  v_followup_number smallint;
  v_max_followups smallint;
  v_prev_agent text;
  v_category text;
  v_next_date date;
  v_next_agent text;
  v_next_followup smallint;
  v_chained boolean := false;
  v_agent text := coalesce(public.current_agent_label(), p_agent_name);
BEGIN
  UPDATE public.outgoing_call_attempts
  SET status = p_status,
      outcome = p_outcome,
      outcome_code = p_outcome_code,
      notes = p_notes,
      called_at = now(),
      callback_at = p_callback_at,
      confirmed = p_confirmed,
      assigned_agent = COALESCE(v_agent, assigned_agent)
  WHERE id = p_attempt_id
    AND status = 'pending'
  RETURNING queue_id, followup_number, COALESCE(v_agent, assigned_agent)
  INTO v_queue_id, v_followup_number, v_prev_agent;

  IF v_queue_id IS NULL THEN
    RAISE EXCEPTION 'Call attempt not found or already actioned.';
  END IF;

  SELECT category INTO v_category
  FROM public.outgoing_call_queue
  WHERE id = v_queue_id;

  IF p_outcome_code = 'already_visited' THEN
    INSERT INTO public.outbound_already_visited_reports
      (attempt_id, queue_id, patient_id, patient_name, phone, agent_name, notes)
    SELECT p_attempt_id, q.id, q.patient_id, q.patient_name, q.phone,
           COALESCE(v_agent, p_agent_name, 'agent'), p_notes
    FROM public.outgoing_call_queue AS q
    WHERE q.id = v_queue_id
    ON CONFLICT (attempt_id) DO UPDATE
      SET notes = excluded.notes,
          agent_name = excluded.agent_name,
          reported_at = now();
  END IF;

  UPDATE public.outgoing_call_queue
  SET followups_done = GREATEST(followups_done, v_followup_number),
      updated_at = now()
  WHERE id = v_queue_id
  RETURNING max_followups INTO v_max_followups;

  v_next_followup := v_followup_number + 1;

  IF p_resolve OR p_status = 'skipped' OR p_outcome_code = 'do_not_call' THEN
    UPDATE public.outgoing_call_queue
    SET status = CASE WHEN p_outcome_code = 'do_not_call' THEN 'removed' ELSE 'resolved' END,
        updated_at = now()
    WHERE id = v_queue_id;
  ELSIF p_outcome_code = 'call_later' AND p_callback_at IS NOT NULL THEN
    v_next_date := p_callback_at::date;

    IF public.outgoing_call_is_prospect_category(v_category) THEN
      v_next_agent := 'Shared';
    ELSE
      v_next_agent := public.get_scheduled_agent(v_next_date);
      IF v_next_agent = v_prev_agent THEN
        v_next_date := v_next_date + 1;
        v_next_agent := public.get_scheduled_agent(v_next_date);
      END IF;
    END IF;

    IF v_next_followup > v_max_followups THEN
      UPDATE public.outgoing_call_queue
      SET max_followups = v_next_followup
      WHERE id = v_queue_id;
    END IF;

    INSERT INTO public.outgoing_call_attempts
      (queue_id, followup_number, scheduled_date, assigned_agent, status, callback_at)
    VALUES
      (v_queue_id, v_next_followup, v_next_date, v_next_agent, 'pending', p_callback_at);
    v_chained := true;
  ELSIF v_next_followup > v_max_followups THEN
    UPDATE public.outgoing_call_queue
    SET status = 'exhausted', updated_at = now()
    WHERE id = v_queue_id;
  ELSE
    v_next_date := (now() AT TIME ZONE 'Asia/Dhaka')::date + p_wait_days;

    IF public.outgoing_call_is_prospect_category(v_category) THEN
      v_next_agent := 'Shared';
    ELSE
      v_next_agent := public.get_scheduled_agent(v_next_date);
      IF v_next_agent = v_prev_agent THEN
        v_next_date := v_next_date + 1;
        v_next_agent := public.get_scheduled_agent(v_next_date);
      END IF;
    END IF;

    INSERT INTO public.outgoing_call_attempts
      (queue_id, followup_number, scheduled_date, assigned_agent, status)
    VALUES
      (v_queue_id, v_next_followup, v_next_date, v_next_agent, 'pending');
    v_chained := true;
  END IF;

  RETURN jsonb_build_object(
    'queue_id', v_queue_id,
    'followup_number', v_followup_number,
    'next_attempt_chained', v_chained,
    'next_attempt_date', v_next_date,
    'next_attempt_agent', v_next_agent
  );
END;
$$;

-- A shared queue means two agents can open the same prospect at once. Lock the
-- attempt while booking so only the first pending action can create an appointment.
CREATE OR REPLACE FUNCTION public.book_appointment_from_call(
  p_attempt_id bigint,
  p_appointment_date date,
  p_appointment_time text,
  p_doctor_service text,
  p_branch text,
  p_notes text DEFAULT NULL::text,
  p_agent_name text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_queue_id bigint;
  v_patient_id integer;
  v_followup_number smallint;
  v_appointment_id bigint;
  v_agent text := coalesce(public.current_agent_label(), p_agent_name, 'outgoing-call');
BEGIN
  SELECT a.queue_id, a.followup_number, q.patient_id
  INTO v_queue_id, v_followup_number, v_patient_id
  FROM public.outgoing_call_attempts AS a
  JOIN public.outgoing_call_queue AS q ON q.id = a.queue_id
  WHERE a.id = p_attempt_id
    AND a.status = 'pending'
  FOR UPDATE OF a;

  IF v_queue_id IS NULL THEN
    RAISE EXCEPTION 'Call attempt not found or already actioned.';
  END IF;

  INSERT INTO public.crm_appointments
    (patient_id, appointment_date, appointment_time, doctor_service, appointment_type,
     appointment_status, confirmation_status, notes, created_by, source_system)
  VALUES
    (v_patient_id, p_appointment_date, p_appointment_time, p_doctor_service, p_branch,
     'Scheduled', 'Confirmed', p_notes, v_agent, 'outgoing_call_queue')
  RETURNING id INTO v_appointment_id;

  UPDATE public.outgoing_call_attempts
  SET status = 'called',
      outcome = 'Booked appointment',
      outcome_code = 'booked_appointment',
      notes = p_notes,
      called_at = now(),
      booked_appointment_id = v_appointment_id,
      assigned_agent = v_agent
  WHERE id = p_attempt_id;

  UPDATE public.outgoing_call_queue
  SET status = 'resolved',
      followups_done = GREATEST(followups_done, v_followup_number),
      updated_at = now()
  WHERE id = v_queue_id;

  RETURN jsonb_build_object(
    'queue_id', v_queue_id,
    'appointment_id', v_appointment_id
  );
END;
$$;

COMMENT ON FUNCTION public.outgoing_call_is_prospect_category(text) IS
  'Classifies outbound lead-generation categories that belong to the shared prospect queue.';

COMMENT ON TRIGGER outgoing_call_attempts_share_prospects ON public.outgoing_call_attempts IS
  'Assigns every new prospect attempt to the shared pool; the actual caller is recorded on completion.';

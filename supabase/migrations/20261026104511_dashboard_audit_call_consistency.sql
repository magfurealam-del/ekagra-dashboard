-- Call report uses the same clinic dates, explicit directions and unassigned buckets as executive reporting.
CREATE OR REPLACE FUNCTION public.get_call_center_kpis_fast(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '10s'
 SET timezone TO 'Asia/Dhaka'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_active_staff() THEN
    RAISE EXCEPTION 'Active staff access required.';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date OR p_end_date-p_start_date > 365 THEN
    RAISE EXCEPTION 'Select a valid reporting period of at most 366 days.' USING ERRCODE='22023';
  END IF;

  WITH
  daily_in AS (
    SELECT lead_date AS d, count(*) AS cnt
    FROM mis_internal.executive_leads
    WHERE lead_date BETWEEN p_start_date AND p_end_date
      AND (nullif(trim(call_direction),'') IS NOT NULL AND NOT (call_direction ILIKE '%outgoing%'))
      AND source_system IS DISTINCT FROM 'messenger_backfill'
    GROUP BY 1
  ),
  daily_out_leads AS (
    SELECT lead_date AS d, count(*) AS cnt
    FROM mis_internal.executive_leads
    WHERE lead_date BETWEEN p_start_date AND p_end_date
      AND call_direction ILIKE '%outgoing%'
      AND source_system IS DISTINCT FROM 'messenger_backfill'
    GROUP BY 1
  ),
  daily_outbound AS (
    SELECT called_at::date AS d, count(*) AS cnt
    FROM outgoing_call_attempts
    WHERE called_at >= p_start_date AND called_at < p_end_date + 1 AND status <> 'pending'
    GROUP BY 1
  ),
  daily_conf AS (
    SELECT coalesce(called_at, created_at)::date AS d, count(*) AS cnt
    FROM appointment_confirmation_calls
    WHERE coalesce(called_at, created_at) >= p_start_date AND coalesce(called_at, created_at) < p_end_date + 1
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'period_start', p_start_date,
    'period_end', p_end_date,

    'incoming_total', (
      SELECT count(*) FROM mis_internal.executive_leads
      WHERE lead_date BETWEEN p_start_date AND p_end_date
        AND (nullif(trim(call_direction),'') IS NOT NULL AND NOT (call_direction ILIKE '%outgoing%'))
        AND source_system IS DISTINCT FROM 'messenger_backfill'
    ),

    'outgoing_leads_total', (
      SELECT count(*) FROM mis_internal.executive_leads
      WHERE lead_date BETWEEN p_start_date AND p_end_date
        AND call_direction ILIKE '%outgoing%'
        AND source_system IS DISTINCT FROM 'messenger_backfill'
    ),

    'outbound_total', (
      SELECT count(*) FROM outgoing_call_attempts
      WHERE called_at::date BETWEEN p_start_date AND p_end_date AND status <> 'pending'
    ),

    'confirmation_total', (
      SELECT count(*) FROM appointment_confirmation_calls
      WHERE coalesce(called_at, created_at)::date BETWEEN p_start_date AND p_end_date
    ),

    'outbound_pending', (SELECT count(*) FROM outgoing_call_queue WHERE status = 'open'),

    'daily_trend', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'date', gs::date,
        'incoming', coalesce(i.cnt, 0),
        'outgoing_leads', coalesce(ol.cnt, 0),
        'outbound', coalesce(ob.cnt, 0),
        'confirmation', coalesce(c.cnt, 0)
      ) ORDER BY gs), '[]'::jsonb)
      FROM generate_series(p_start_date, p_end_date, interval '1 day') gs
      LEFT JOIN daily_in        i  ON i.d  = gs::date
      LEFT JOIN daily_out_leads ol ON ol.d = gs::date
      LEFT JOIN daily_outbound  ob ON ob.d = gs::date
      LEFT JOIN daily_conf       c ON c.d  = gs::date
    ),

    'by_outbound_outcome', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('outcome', o, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT coalesce(NULLIF(outcome_code, ''), 'unspecified') AS o, count(*) AS cnt
        FROM outgoing_call_attempts
        WHERE called_at::date BETWEEN p_start_date AND p_end_date AND status <> 'pending'
        GROUP BY 1
      ) x
    ),

    'by_incoming_outcome', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('outcome', o, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT public.call_kpi_incoming_outcome_label(lead_status) AS o, count(*) AS cnt
        FROM mis_internal.executive_leads
        WHERE lead_date BETWEEN p_start_date AND p_end_date
          AND (nullif(trim(call_direction),'') IS NOT NULL AND NOT (call_direction ILIKE '%outgoing%'))
          AND source_system IS DISTINCT FROM 'messenger_backfill'
        GROUP BY 1
      ) x
    ),

    'by_outgoing_outcome', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('outcome', o, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT public.call_kpi_incoming_outcome_label(lead_status) AS o, count(*) AS cnt
        FROM mis_internal.executive_leads
        WHERE lead_date BETWEEN p_start_date AND p_end_date
          AND call_direction ILIKE '%outgoing%'
          AND source_system IS DISTINCT FROM 'messenger_backfill'
        GROUP BY 1
      ) x
    ),

    'by_confirmation_outcome', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('outcome', initcap(replace(coalesce(outcome,'unspecified'), '_', ' ')), 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT outcome, count(*) AS cnt
        FROM appointment_confirmation_calls
        WHERE coalesce(called_at, created_at)::date BETWEEN p_start_date AND p_end_date
        GROUP BY 1
      ) x
    ),

    'by_agent', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'agent', agent,
        'incoming', incoming_cnt,
        'incoming_booked', incoming_booked_cnt,
        'outgoing_leads', outgoing_leads_cnt,
        'outgoing_leads_booked', outgoing_leads_booked_cnt,
        'outbound', outbound_cnt,
        'outbound_reached', outbound_reached_cnt,
        'outbound_booked', outbound_booked_cnt,
        'confirmation', confirmation_cnt,
        'confirmation_confirmed', confirmation_confirmed_cnt
      ) ORDER BY (incoming_cnt + outgoing_leads_cnt + outbound_cnt + confirmation_cnt) DESC), '[]'::jsonb)
      FROM (
        SELECT
          coalesce(i.agent_name, o.assigned_agent, c.agent_name) AS agent,
          coalesce(i.incoming_cnt, 0)              AS incoming_cnt,
          coalesce(i.incoming_booked_cnt, 0)       AS incoming_booked_cnt,
          coalesce(i.outgoing_leads_cnt, 0)        AS outgoing_leads_cnt,
          coalesce(i.outgoing_leads_booked_cnt, 0) AS outgoing_leads_booked_cnt,
          coalesce(o.cnt, 0)                       AS outbound_cnt,
          coalesce(o.reached_cnt, 0)               AS outbound_reached_cnt,
          coalesce(o.booked_cnt, 0)                AS outbound_booked_cnt,
          coalesce(c.cnt, 0)                       AS confirmation_cnt,
          coalesce(c.confirmed_cnt, 0)             AS confirmation_confirmed_cnt
        FROM (
          SELECT coalesce(nullif(trim(agent_name),''),'Unassigned') agent_name,
                 count(*) FILTER (WHERE (nullif(trim(call_direction),'') IS NOT NULL AND NOT (call_direction ILIKE '%outgoing%'))) AS incoming_cnt,
                 count(*) FILTER (WHERE (nullif(trim(call_direction),'') IS NOT NULL AND NOT (call_direction ILIKE '%outgoing%'))
                   AND lower(coalesce(lead_status,'')) IN ('appointment_booked','appointment done','appointment_done')) AS incoming_booked_cnt,
                 count(*) FILTER (WHERE call_direction ILIKE '%outgoing%') AS outgoing_leads_cnt,
                 count(*) FILTER (WHERE call_direction ILIKE '%outgoing%'
                   AND lower(coalesce(lead_status,'')) IN ('appointment_booked','appointment done','appointment_done')) AS outgoing_leads_booked_cnt
          FROM mis_internal.executive_leads
          WHERE lead_date BETWEEN p_start_date AND p_end_date
            AND source_system IS DISTINCT FROM 'messenger_backfill'
          GROUP BY coalesce(nullif(trim(agent_name),''),'Unassigned')
        ) i
        FULL OUTER JOIN (
          SELECT coalesce(nullif(trim(assigned_agent),''),'Unassigned') assigned_agent, count(*) AS cnt,
                 count(*) FILTER (WHERE outcome_code IN ('reached','booked_appointment')) AS reached_cnt,
                 count(*) FILTER (WHERE outcome_code = 'booked_appointment') AS booked_cnt
          FROM outgoing_call_attempts
          WHERE called_at::date BETWEEN p_start_date AND p_end_date AND status <> 'pending'
          GROUP BY coalesce(nullif(trim(assigned_agent),''),'Unassigned')
        ) o ON o.assigned_agent = i.agent_name
        FULL OUTER JOIN (
          SELECT coalesce(nullif(trim(agent_name),''),'Unassigned') agent_name, count(*) AS cnt,
                 count(*) FILTER (WHERE outcome = 'confirmed') AS confirmed_cnt
          FROM appointment_confirmation_calls
          WHERE coalesce(called_at, created_at)::date BETWEEN p_start_date AND p_end_date
          GROUP BY coalesce(nullif(trim(agent_name),''),'Unassigned')
        ) c ON c.agent_name = coalesce(i.agent_name, o.assigned_agent)
      ) x
      WHERE agent IS NOT NULL
    ),

    'call_log', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'attempt_id', attempt_id,
        'call_date', call_date,
        'direction', direction,
        'source', source,
        'patient_name', patient_name,
        'patient_type', patient_type,
        'phone', phone,
        'agent', agent,
        'outcome', outcome,
        'outcome_code', outcome_code,
        'notes', notes,
        'hospital_id', hospital_id,
        'location', location,
        'doctor_service', doctor_service,
        'appointment_date', appointment_date,
        'appointment_time', appointment_time,
        'patient_id', patient_id,
        'invoice_check_date', invoice_check_date,
        'invoice_match', NULL,
        'details', details
      ) ORDER BY call_date DESC), '[]'::jsonb)
      FROM (
        (
          -- crm_leads: Incoming or Outgoing based on call_direction field.
          -- Excludes rows written by the one-time Messenger backfill
          -- (source_system = 'messenger_backfill') — those are automated
          -- Messenger contacts, not calls handled by a call-center agent.
          -- De-dup 1: suppress rows where an earlier-id lead exists for the
          --   same patient within a 5-second window (double-submit / bulk import).
          -- De-dup 2: suppress crm_leads that duplicate a near-simultaneous
          --   outbound-queue attempt booking for the same patient (cross-sheet dup).
          SELECT NULL::bigint AS attempt_id,
                 CASE WHEN l.source_system='migrated_call_center_logs' THEN l.lead_date::timestamptz ELSE l.created_at END AS call_date,
                 CASE WHEN l.call_direction ILIKE '%outgoing%' THEN 'Outgoing' ELSE 'Incoming' END AS direction,
                 public.call_kpi_lead_source_label(l.source) AS source,
                 l.lead_name AS patient_name,
                 public.call_kpi_patient_type_label(coalesce(l.patient_type, pt.patient_type)) AS patient_type,
                 l.phone AS phone, l.agent_name AS agent,
                 public.call_kpi_incoming_outcome_label(l.lead_status) AS outcome,
                 NULL::text AS outcome_code,
                 l.notes AS notes,
                 pt.hn AS hospital_id,
                 pt.area AS location,
                 ap1.doctor_service AS doctor_service,
                 ap1.appointment_date, ap1.appointment_time,
                 coalesce(l.patient_id, pt.id) AS patient_id,
                 ap1.appointment_date AS invoice_check_date,
                 jsonb_build_object(
                   'date_basis', CASE WHEN l.source_system='migrated_call_center_logs' THEN 'Original contact date; time unavailable' ELSE NULL END,
                   'campaign', l.campaign_name,
                   'referral_name', l.referral_name,
                   'patient_type', l.patient_type,
                   'main_problem', l.main_problem,
                   'lead_bucket', l.lead_bucket,
                   'urgency', l.urgency,
                   'priority', l.priority,
                   'diabetes_status', l.diabetes_status
                 ) AS details
          FROM mis_internal.executive_leads l
          LEFT JOIN patients pt ON pt.id = l.patient_id
          LEFT JOIN LATERAL (
            SELECT ap.appointment_date, ap.appointment_time, ap.doctor_service
            FROM crm_appointments ap
            WHERE ap.lead_id = l.id
            ORDER BY ap.created_at DESC
            LIMIT 1
          ) ap1 ON true
          WHERE l.lead_date BETWEEN p_start_date AND p_end_date
            AND l.source_system IS DISTINCT FROM 'messenger_backfill'
            AND nullif(trim(l.call_direction),'') IS NOT NULL
            -- De-dup 1: keep only the first submission in any 5-second burst per patient
            AND NOT EXISTS (
              SELECT 1 FROM mis_internal.executive_leads earlier
              WHERE earlier.patient_id = l.patient_id
                AND earlier.id < l.id
                AND earlier.created_at BETWEEN l.created_at - interval '5 seconds'
                                           AND l.created_at + interval '5 seconds'
            )
            -- De-dup 2: suppress crm_lead if a completed outbound queue attempt
            -- for the same patient booked an appointment within 15 minutes
            AND NOT (
              l.lead_status = 'appointment_booked'
              AND EXISTS (
                SELECT 1
                FROM outgoing_call_attempts a2
                JOIN outgoing_call_queue q2 ON q2.id = a2.queue_id
                WHERE q2.patient_id = l.patient_id
                  AND a2.outcome_code = 'booked_appointment'
                  AND a2.status <> 'pending'
                  AND a2.called_at BETWEEN l.created_at - interval '15 minutes'
                                       AND l.created_at + interval '15 minutes'
              )
            )
        )
        UNION ALL
        (
          -- Outbound: queue-based outgoing_call_attempts
          SELECT a.id AS attempt_id,
                 a.called_at AS call_date, 'Outbound' AS direction,
                 public.call_kpi_queue_category_label(q.category) AS source,
                 q.patient_name AS patient_name,
                 public.call_kpi_patient_type_label(pt.patient_type) AS patient_type,
                 q.phone AS phone, a.assigned_agent AS agent,
                 -- Match the "Appointment Booked" wording used by the
                 -- Incoming/Outgoing branch (call_kpi_incoming_outcome_label)
                 -- instead of the generic outcome_code->text conversion, so
                 -- the same real-world outcome doesn't show two different
                 -- labels ("Booked Appointment" vs "Appointment Booked") in
                 -- one unified Call Log column.
                 CASE WHEN a.outcome_code = 'booked_appointment' THEN 'Appointment Booked'
                      ELSE initcap(replace(coalesce(a.outcome_code, 'unspecified'), '_', ' ')) END AS outcome,
                 a.outcome_code AS outcome_code,
                 a.notes AS notes,
                 pt.hn AS hospital_id,
                 pt.area AS location,
                 ap2.doctor_service AS doctor_service,
                 ap2.appointment_date, ap2.appointment_time,
                 q.patient_id,
                 coalesce(ap2.appointment_date, CASE WHEN a.outcome_code = 'already_visited' THEN q.relevant_date END) AS invoice_check_date,
                 jsonb_build_object(
                   'category', q.category,
                   'reason', q.reason,
                   'followup_number', a.followup_number,
                   'scheduled_date', a.scheduled_date
                 ) AS details
          FROM outgoing_call_attempts a
          JOIN outgoing_call_queue q ON q.id = a.queue_id
          LEFT JOIN patients pt ON pt.id = q.patient_id
          LEFT JOIN crm_appointments ap2 ON ap2.id = a.booked_appointment_id
          WHERE a.called_at::date BETWEEN p_start_date AND p_end_date AND a.status <> 'pending'
        )
        UNION ALL
        (
          -- Confirmation calls
          SELECT NULL::bigint AS attempt_id,
                 coalesce(cc.called_at, cc.created_at) AS call_date,
                 CASE WHEN cc.call_type = 'night_before' THEN 'Confirmation - Night Before' ELSE 'Confirmation - Morning Of' END AS direction,
                 'Appointment Confirmation' AS source,
                 p.full_name AS patient_name,
                 public.call_kpi_patient_type_label(p.patient_type) AS patient_type,
                 p.phone AS phone, cc.agent_name AS agent,
                 initcap(replace(coalesce(cc.outcome, 'unspecified'), '_', ' ')) AS outcome,
                 NULL::text AS outcome_code,
                 cc.notes AS notes,
                 p.hn AS hospital_id,
                 p.area AS location,
                 ap.doctor_service AS doctor_service,
                 ap.appointment_date, ap.appointment_time,
                 cc.patient_id,
                 ap.appointment_date AS invoice_check_date,
                 jsonb_build_object(
                   'appointment_type', ap.appointment_type,
                   'attempt_number', cc.attempt_number
                 ) AS details
          FROM appointment_confirmation_calls cc
          LEFT JOIN patients p ON p.id = cc.patient_id
          LEFT JOIN crm_appointments ap ON ap.id = cc.appointment_id
          WHERE coalesce(cc.called_at, cc.created_at)::date BETWEEN p_start_date AND p_end_date
        )
      ) all_calls

    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_call_center_kpis_fast(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_call_center_kpis_fast(date,date) TO authenticated;

-- Preserve the executive contract while applying the same call-direction rule.
DO $audit$
DECLARE original text; updated text;
BEGIN
 SELECT pg_get_functiondef('mis_internal.executive_agents(date,date)'::regprocedure) INTO original;
 updated := replace(original, 'NOT (coalesce(call_direction,'''') ILIKE ''%outgoing%'')', '(nullif(trim(call_direction),'''') IS NOT NULL AND NOT (call_direction ILIKE ''%outgoing%''))');
 IF updated=original THEN RAISE EXCEPTION 'Expected executive call-direction expression was not found'; END IF;
 updated := replace(updated,'SELECT assigned_agent,', 'SELECT coalesce(nullif(trim(assigned_agent),''''),''Unassigned'') assigned_agent,');
 updated := replace(updated,' AND assigned_agent IS NOT NULL','');
 updated := replace(updated,'GROUP BY assigned_agent', 'GROUP BY coalesce(nullif(trim(assigned_agent),''''),''Unassigned'')');
 updated := replace(updated,'coalesce(agent_name,''Unassigned'')','coalesce(nullif(trim(agent_name),''''),''Unassigned'')');
 EXECUTE updated;
END $audit$;
NOTIFY pgrst, 'reload schema';


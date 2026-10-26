-- Reporting only: no patient, appointment, billing, attribution or workflow mutations.
-- All dates are clinic-calendar dates. A stable RPC reads one MVCC snapshot.
CREATE VIEW mis_internal.executive_leads AS
 SELECT cl.*, coalesce(e.contact_date,(cl.created_at AT TIME ZONE 'Asia/Dhaka')::date) lead_date,
 CASE WHEN coalesce(nullif(la.source_category,''),nullif(cl.source,'')) ILIKE '%facebook%' THEN 'Facebook'
 ELSE initcap(coalesce(nullif(la.source_category,''),nullif(cl.source,''),'Unknown')) END source_name
 FROM public.crm_leads cl LEFT JOIN public.lead_attribution la ON la.lead_id=cl.id
 LEFT JOIN (SELECT evidence_id,min(event_date) contact_date FROM mis_internal.marketing_source_evidence_v2
 WHERE evidence_table='crm_leads' GROUP BY evidence_id) e ON e.evidence_id=cl.id::text;

-- One invoice cannot prove two separate completed appointments. Ambiguous duplicates
-- stay unresolved; we do not choose an arbitrary winner or change source records.
CREATE VIEW mis_internal.executive_appointments AS
 WITH evidence AS (
 SELECT a.*,coalesce(s.strict_attendance_verified,false) exact_evidence,
 count(*) FILTER(WHERE s.strict_attendance_verified AND a.appointment_status='Completed')
 OVER(PARTITION BY a.matched_invoice_id) evidence_uses
 FROM public.crm_appointments a LEFT JOIN mis_internal.strict_appointment_attendance s ON s.appointment_id=a.id
 ), flags AS (
 SELECT e.*,
 appointment_date < (statement_timestamp() AT TIME ZONE 'Asia/Dhaka')::date - 1
 AND coalesce(appointment_status,'') NOT IN ('Cancelled','Rescheduled') eligible,
 exact_evidence AND appointment_status='Completed' AND evidence_uses=1 verified,
 exact_evidence AND (appointment_status<>'Completed' OR evidence_uses>1) evidence_conflict
 FROM evidence e)
 SELECT f.*,eligible AND verified attended,
 eligible AND appointment_status='No-show' AND NOT exact_evidence explicit_no_show
 FROM flags f;

-- Billing links currently have one CRM owner per invoice. Reject ambiguous owners
-- defensively, collapse identical links, and exclude void/cancelled/unmatched invoices.
CREATE VIEW mis_internal.executive_revenue AS
 SELECT i.id invoice_id,i.patient_id,i.invoice_date,min(b.source_record_id) lead_id,
 max(b.attributed_revenue) revenue
 FROM public.crm_billing_links b JOIN public.invoices i ON i.id=b.invoice_id
 JOIN public.crm_leads l ON l.id::text=b.source_record_id AND l.patient_id=i.patient_id
 WHERE b.source_table='crm_leads' AND i.reconciliation_status='matched'
 AND coalesce(i.invoice_status,'') NOT IN ('void','cancelled')
 GROUP BY i.id,i.patient_id,i.invoice_date
 HAVING count(DISTINCT b.source_record_id)=1 AND min(b.attributed_revenue)=max(b.attributed_revenue);
REVOKE ALL ON mis_internal.executive_leads,mis_internal.executive_appointments,mis_internal.executive_revenue FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION mis_internal.executive_overview(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'mis_internal'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- Allow the nightly refresh_dashboard_metric_snapshot_cron job to call this via the
  -- service_role key (no auth.uid() context in that case) in addition to real admins.
  IF NOT (is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;

  SELECT jsonb_build_object(
    'period_start', p_start_date,
    'period_end', p_end_date,

    'total_leads', (SELECT count(*) FROM mis_internal.executive_leads WHERE lead_date BETWEEN p_start_date AND p_end_date),
    'booked_leads', (SELECT count(*) FROM mis_internal.executive_leads WHERE lead_date BETWEEN p_start_date AND p_end_date AND lower(coalesce(lead_status,'')) IN ('appointment_booked','appointment done','appointment_done')),
    'suppressed_leads', (SELECT count(*) FROM mis_internal.executive_leads WHERE lead_date BETWEEN p_start_date AND p_end_date AND lead_status = 'suppressed'),

    'by_patient_type', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('type', t, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT public.call_kpi_patient_type_label(patient_type) AS t, count(*) AS cnt
        FROM mis_internal.executive_leads WHERE lead_date BETWEEN p_start_date AND p_end_date
        GROUP BY 1
      ) x
    ),

    'by_source',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY count DESC),'[]') FROM (
 SELECT source_name source,count(*) count FROM mis_internal.executive_leads WHERE lead_date BETWEEN p_start_date AND p_end_date GROUP BY 1)s),
    'by_intake_outcome', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('outcome', o, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT
          CASE
            WHEN lower(coalesce(lead_status,'')) IN ('appointment_booked','appointment done','appointment_done') THEN 'Appointment Booked'
            WHEN lower(coalesce(lead_status,'')) LIKE '%no appointment%' OR lower(coalesce(lead_status,'')) = 'no_appointment_follow_up' THEN 'No Appointment Yet'
            WHEN lower(coalesce(lead_status,'')) LIKE '%no show%' THEN 'No-show'
            WHEN lower(coalesce(lead_status,'')) LIKE '%not interested%' THEN 'Not Interested'
            WHEN lower(coalesce(lead_status,'')) LIKE '%general inquiry%' THEN 'General Inquiry'
            WHEN lower(coalesce(lead_status,'')) = 'callback_scheduled' THEN 'Call Back Later'
            WHEN lower(coalesce(lead_status,'')) = 'suppressed' THEN 'Suppressed'
            ELSE initcap(coalesce(lead_status, 'Unspecified'))
          END AS o,
          count(*) AS cnt
        FROM mis_internal.executive_leads WHERE lead_date BETWEEN p_start_date AND p_end_date
        GROUP BY 1
      ) x
    ),

    'by_agent', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'agent', agent_name, 'leads', cnt,
        'booked', booked_cnt,
        'booking_rate', round(100.0 * booked_cnt / NULLIF(cnt,0), 1)
      ) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT agent_name, count(*) AS cnt,
               count(*) FILTER (WHERE lower(coalesce(lead_status,'')) IN ('appointment_booked','appointment done','appointment_done')) AS booked_cnt
        FROM mis_internal.executive_leads
        WHERE lead_date BETWEEN p_start_date AND p_end_date AND agent_name IS NOT NULL
        GROUP BY agent_name
      ) x
    ),

    'by_location', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('area', a, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT coalesce(NULLIF(trim(p.area), ''), 'Unspecified') AS a, count(*) AS cnt
        FROM mis_internal.executive_leads l
        LEFT JOIN patients p ON p.id = l.patient_id
        WHERE l.lead_date BETWEEN p_start_date AND p_end_date
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 8
      ) x
    ),

    'total_appointments', (SELECT count(*) FROM crm_appointments WHERE appointment_date BETWEEN p_start_date AND p_end_date),

    'attended', (SELECT count(*) FROM mis_internal.executive_appointments WHERE attended AND appointment_date BETWEEN p_start_date AND p_end_date),
    'no_shows', (SELECT count(*) FROM mis_internal.executive_appointments WHERE explicit_no_show AND appointment_date BETWEEN p_start_date AND p_end_date),
    'cancelled', (SELECT count(*) FROM crm_appointments WHERE appointment_status='Cancelled' AND appointment_date BETWEEN p_start_date AND p_end_date),
    'show_rate', (SELECT round(100.0*count(*) FILTER(WHERE attended)/nullif(count(*) FILTER(WHERE eligible),0),1) FROM mis_internal.executive_appointments WHERE appointment_date BETWEEN p_start_date AND p_end_date),
    'by_doctor', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('doctor', doctor_service, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT doctor_service, count(*) AS cnt
        FROM crm_appointments
        WHERE appointment_date BETWEEN p_start_date AND p_end_date AND doctor_service IS NOT NULL AND doctor_service <> ''
        GROUP BY doctor_service
        ORDER BY 2 DESC LIMIT 8
      ) x
    ),

    'by_doctor_performance', '[]'::jsonb,
    'by_service_type', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('type', t, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT coalesce(NULLIF(appointment_type,''), 'Unspecified') AS t, count(*) AS cnt
        FROM crm_appointments
        WHERE appointment_date BETWEEN p_start_date AND p_end_date
        GROUP BY 1
      ) x
    ),

    'pending_callbacks', (SELECT count(*) FROM outgoing_call_queue WHERE status = 'open'),

    'daily_trend', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('date', d, 'leads', leads_cnt, 'appointments', appt_cnt) ORDER BY d), '[]'::jsonb)
      FROM (
        SELECT gs::date AS d,
          (SELECT count(*) FROM mis_internal.executive_leads WHERE lead_date = gs::date) AS leads_cnt,
          (SELECT count(*) FROM crm_appointments WHERE appointment_date = gs::date) AS appt_cnt
        FROM generate_series(p_start_date, p_end_date, interval '1 day') gs
      ) x
    ),

    'total_revenue',(SELECT coalesce(sum(revenue),0) FROM mis_internal.executive_revenue WHERE invoice_date BETWEEN p_start_date AND p_end_date),
    'revenue_by_source',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY revenue DESC),'[]') FROM (
      SELECT l.source_name source,sum(b.revenue) revenue FROM mis_internal.executive_revenue b
      JOIN mis_internal.executive_leads l ON l.id::text=b.lead_id
      WHERE b.invoice_date BETWEEN p_start_date AND p_end_date GROUP BY 1)r),
    'follow_up_funnel', (
      SELECT jsonb_build_object(
        'logged', count(*),
        'reached', count(*) FILTER (WHERE NOT (
          lower(outcome) LIKE '%no response%' OR lower(outcome) LIKE '%not reach%' OR
          lower(outcome) LIKE '%switched off%' OR lower(outcome) LIKE '%call not received%' OR
          lower(outcome) LIKE '%number off%'
        )),
        'positive', count(*) FILTER (WHERE
          lower(outcome) LIKE '%appoint%' OR lower(outcome) LIKE '%problem solved%' OR
          lower(outcome) LIKE '%valo ache%' OR lower(outcome) LIKE '%ashben%' OR lower(outcome) LIKE '%aste chan%'
        )
      )
      FROM crm_follow_ups WHERE call_date BETWEEN p_start_date AND p_end_date
    ),

    'field_confirmations', (
      SELECT jsonb_build_object(
        'total', count(*),
        'by_field', coalesce((
          SELECT jsonb_agg(jsonb_build_object('field', f, 'count', cnt) ORDER BY cnt DESC)
          FROM (
            SELECT CASE operation
                     WHEN 'update_status' THEN 'Appointment Status'
                     WHEN 'update_hn' THEN 'Hospital ID'
                     WHEN 'update_hospital_id' THEN 'Hospital ID'
                     WHEN 'update_contact_info' THEN 'Patient Name / Phone'
                     ELSE operation
                   END AS f,
                   count(*) AS cnt
            FROM sync_audit_log
            WHERE source_system = 'app'
              AND table_name IN ('crm_appointments','patients')
              AND operation IN ('update_status','update_hn','update_hospital_id','update_contact_info')
              AND (created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN p_start_date AND p_end_date
            GROUP BY 1
          ) fx
        ), '[]'::jsonb),
        'by_agent', coalesce((
          SELECT jsonb_agg(jsonb_build_object('agent', a, 'count', cnt) ORDER BY cnt DESC)
          FROM (
            SELECT coalesce(NULLIF(payload->>'changed_by',''), 'Unknown') AS a, count(*) AS cnt
            FROM sync_audit_log
            WHERE source_system = 'app'
              AND table_name IN ('crm_appointments','patients')
              AND operation IN ('update_status','update_hn','update_hospital_id','update_contact_info')
              AND (created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN p_start_date AND p_end_date
            GROUP BY 1
          ) ax
        ), '[]'::jsonb)
      )
      FROM sync_audit_log
      WHERE source_system = 'app'
        AND table_name IN ('crm_appointments','patients')
        AND operation IN ('update_status','update_hn','update_hospital_id','update_contact_info')
        AND (created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN p_start_date AND p_end_date
    )
  ) INTO v_result;

  RETURN v_result || jsonb_build_object(
    'contract_version',2,'timezone','Asia/Dhaka',
    'mis_verified_attended',v_result->'attended','explicit_crm_no_shows',v_result->'no_shows',
    'completed_appointments_without_mis_visit_proof',(SELECT count(*) FROM mis_internal.executive_appointments WHERE eligible AND appointment_status='Completed' AND NOT verified AND appointment_date BETWEEN p_start_date AND p_end_date),
    'attendance',(SELECT jsonb_build_object(
      'eligible',count(*) FILTER(WHERE eligible),'verified',count(*) FILTER(WHERE attended),
      'explicit_no_show',count(*) FILTER(WHERE explicit_no_show),
      'unresolved',count(*) FILTER(WHERE eligible AND NOT attended AND NOT explicit_no_show),
      'excluded',count(*) FILTER(WHERE coalesce(appointment_status,'') IN ('Cancelled','Rescheduled')),
      'awaiting_maturity',count(*) FILTER(WHERE NOT eligible AND coalesce(appointment_status,'') NOT IN ('Cancelled','Rescheduled')),
      'evidence_conflicts',count(*) FILTER(WHERE evidence_conflict),
      'eligible_through',(statement_timestamp() AT TIME ZONE 'Asia/Dhaka')::date-2,
      'grace_full_days',1,'no_charge_evidence_available',false)
      FROM mis_internal.executive_appointments WHERE appointment_date BETWEEN p_start_date AND p_end_date),
    'lead_cohort',(SELECT jsonb_build_object('leads',count(*),
      'with_appointment',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM crm_appointments a WHERE a.lead_id=l.id AND a.appointment_status NOT IN ('Cancelled','Rescheduled'))),
      'with_verified_visit',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM mis_internal.executive_appointments a WHERE a.lead_id=l.id AND a.attended)))
      FROM mis_internal.executive_leads l WHERE lead_date BETWEEN p_start_date AND p_end_date),
    'validation',jsonb_build_object(
      'attributed_invoice_count',(SELECT count(*) FROM mis_internal.executive_revenue WHERE invoice_date BETWEEN p_start_date AND p_end_date),
      'attributed_leads',(SELECT count(*) FROM mis_internal.executive_leads WHERE lead_date BETWEEN p_start_date AND p_end_date AND source_name<>'Unknown'),
      'approved_invoice_matches',(SELECT count(*) FROM public.crm_invoice_reconciliation WHERE match_status IN ('matched','approved_auto') AND invoice_date BETWEEN p_start_date AND p_end_date),
      'invoice_matches_needing_review',(SELECT count(*) FROM public.crm_invoice_reconciliation WHERE match_status LIKE 'needs_review%' AND invoice_date BETWEEN p_start_date AND p_end_date))
  );
END;
$function$

;
CREATE OR REPLACE FUNCTION mis_internal.executive_sources(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'mis_internal'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;

  WITH
  lead_src AS (
 SELECT cl.*,public.call_kpi_patient_type_label(cl.patient_type) patient_type_label
 FROM mis_internal.executive_leads cl
 ),
  appts AS (
    SELECT ca.id, ca.appointment_date, ca.appointment_status, ca.patient_id, ls.source_name, ls.patient_type_label
    FROM crm_appointments ca
    JOIN lead_src ls ON ls.id = ca.lead_id
    WHERE ca.appointment_date BETWEEN p_start_date AND p_end_date

    UNION ALL

    SELECT ca.id, ca.appointment_date, ca.appointment_status, ca.patient_id,
      'Outbound Follow-up' AS source_name,
      public.call_kpi_patient_type_label(pt.patient_type) AS patient_type_label
    FROM crm_appointments ca
    LEFT JOIN patients pt ON pt.id = ca.patient_id
    WHERE ca.lead_id IS NULL AND ca.outbound_attempt_id IS NOT NULL
      AND ca.appointment_date BETWEEN p_start_date AND p_end_date

    UNION ALL

    SELECT ca.id, ca.appointment_date, ca.appointment_status, ca.patient_id,
      'Unattributed / Historical' AS source_name,
      public.call_kpi_patient_type_label(pt.patient_type) AS patient_type_label
    FROM crm_appointments ca
    LEFT JOIN patients pt ON pt.id = ca.patient_id
    WHERE ca.lead_id IS NULL AND ca.outbound_attempt_id IS NULL
      AND ca.appointment_date BETWEEN p_start_date AND p_end_date
  ),
  leads_agg AS (
    SELECT source_name,
      count(*) AS leads,
      count(*) FILTER (WHERE patient_type_label = 'New') AS new_leads,
      count(*) FILTER (WHERE patient_type_label = 'Old') AS old_leads
    FROM lead_src
    WHERE lead_date BETWEEN p_start_date AND p_end_date
    GROUP BY source_name
  ),
  -- Per-source appointment counts, eligibility, and no-shows, each also
  -- split New vs Old so the per-source funnel can show two bars per stage
  -- instead of one combined number.
  appts_flags AS (
 SELECT a.*,f.eligible is_eligible,f.explicit_no_show is_no_show,f.attended is_attended
 FROM appts a JOIN mis_internal.executive_appointments f ON f.id=a.id
 ),
  appts_agg AS (
    SELECT source_name,
      count(*) AS appts_cnt,
      count(*) FILTER (WHERE patient_type_label = 'New') AS new_appts_cnt,
      count(*) FILTER (WHERE patient_type_label <> 'New') AS old_appts_cnt,
      count(*) FILTER (WHERE is_eligible) AS eligible_cnt,
      count(*) FILTER (WHERE is_no_show) AS no_show_cnt,
      count(*) FILTER (WHERE is_attended AND patient_type_label='New') AS new_attended,
      count(*) FILTER (WHERE is_attended AND patient_type_label<>'New') AS old_attended
    FROM appts_flags
    GROUP BY source_name
  ),
  revenue AS (
    SELECT CASE WHEN i.attributed_source='facebook' THEN 'Facebook'
      WHEN i.attributed_source IS NULL THEN 'Unattributed / Historical'
      ELSE initcap(i.attributed_source) END source_name,
      sum(i.net_bill) FILTER(WHERE i.invoice_date=p.first_clinical_invoice_date) revenue_new,
      sum(i.net_bill) FILTER(WHERE i.invoice_date IS DISTINCT FROM p.first_clinical_invoice_date) revenue_followup
    FROM mis_internal.shadow_invoice_attribution i
    JOIN mis_internal.shadow_patient_acquisitions p USING(patient_id)
    WHERE i.invoice_date BETWEEN p_start_date AND p_end_date GROUP BY 1
  ),
  pt_leads AS (
    SELECT patient_type_label, count(*) AS leads_cnt
    FROM lead_src
    WHERE lead_date BETWEEN p_start_date AND p_end_date
    GROUP BY patient_type_label
  ),
  pt_appts AS (
    SELECT patient_type_label,
      count(*) AS appts_cnt,
      count(*) FILTER (WHERE is_eligible) AS eligible_cnt,
      count(*) FILTER (WHERE is_no_show) AS no_show_cnt,
      count(*) FILTER (WHERE is_attended) AS attended_cnt
    FROM appts_flags
    GROUP BY patient_type_label
  ),
  first_appt AS (
    SELECT ca.lead_id, min(ca.appointment_date) AS first_appt_date
    FROM crm_appointments ca
    WHERE ca.lead_id IS NOT NULL
    GROUP BY ca.lead_id
  ),
  tta AS (
    SELECT ls.source_name,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY (fa.first_appt_date - ls.lead_date)) AS median_days,
      avg(fa.first_appt_date - ls.lead_date) AS avg_days,
      count(*) AS n
    FROM lead_src ls
    JOIN first_appt fa ON fa.lead_id = ls.id
    WHERE ls.lead_date BETWEEN p_start_date AND p_end_date
      AND fa.first_appt_date >= ls.lead_date
    GROUP BY ls.source_name
  ),
  matrix AS (
    SELECT source_name, coalesce(agent_name, 'Unassigned') AS agent_name, count(*) AS leads
    FROM lead_src
    WHERE lead_date BETWEEN p_start_date AND p_end_date
    GROUP BY source_name, coalesce(agent_name, 'Unassigned')
  )
  SELECT jsonb_build_object(
    'period_start', p_start_date,
    'period_end', p_end_date,
    'sources', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'source', coalesce(la.source_name, aa.source_name, r.source_name),
        'leads', coalesce(la.leads, 0),
        'new_leads', coalesce(la.new_leads, 0),
        'old_leads', coalesce(la.old_leads, 0),
        'unknown_leads',coalesce(la.leads-la.new_leads-la.old_leads,0),
        'appointments_set', coalesce(aa.appts_cnt, 0),
        'new_appointments_set', coalesce(aa.new_appts_cnt, 0),
        'old_appointments_set', coalesce(aa.old_appts_cnt, 0),
        'appointments_eligible', coalesce(aa.eligible_cnt, 0),
        'no_shows', coalesce(aa.no_show_cnt, 0),
        'no_show_rate', round(100.0 * coalesce(aa.no_show_cnt, 0) / NULLIF(aa.eligible_cnt, 0), 1),
        'new_attended', coalesce(aa.new_attended, 0),
        'old_attended', coalesce(aa.old_attended, 0),
        'revenue_new', coalesce(r.revenue_new, 0),
        'revenue_followup', coalesce(r.revenue_followup, 0)
      ) ORDER BY coalesce(la.leads, 0) DESC)
      FROM leads_agg la
      FULL OUTER JOIN appts_agg aa ON aa.source_name = la.source_name
      FULL OUTER JOIN revenue r ON r.source_name = coalesce(la.source_name, aa.source_name)
    ), '[]'::jsonb),
    'patient_type_funnel', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'type', coalesce(l.patient_type_label, a.patient_type_label),
        'leads', coalesce(l.leads_cnt, 0),
        'appointments_set', coalesce(a.appts_cnt, 0),
        'attended', coalesce(a.attended_cnt, 0)
      ))
      FROM pt_leads l
      FULL OUTER JOIN pt_appts a ON a.patient_type_label = l.patient_type_label
    ), '[]'::jsonb),
    'time_to_appointment', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'source', source_name,
        'median_days', round(median_days::numeric, 1),
        'avg_days', round(avg_days::numeric, 1),
        'n', n
      ) ORDER BY median_days)
      FROM tta
    ), '[]'::jsonb),
    'source_agent_matrix', coalesce((
      SELECT jsonb_agg(jsonb_build_object('source', source_name, 'agent', agent_name, 'leads', leads))
      FROM matrix
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result || jsonb_build_object('revenue_basis','All reconciled invoices by acquisition source and invoice date; includes unattributed and historical patients. Not the CRM-linked revenue subset.');
END;
$function$

;
CREATE OR REPLACE FUNCTION mis_internal.executive_agents(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'mis_internal'
AS $function$
DECLARE
  v_result jsonb;
  v_total_patients_with_appointments integer;
  v_invoice_workflow_completed integer;
  v_invoice_workflow_no_show integer;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;

  SELECT count(DISTINCT patient_id) INTO v_total_patients_with_appointments
  FROM crm_appointments
  WHERE appointment_date BETWEEN p_start_date AND p_end_date;

  -- Booked -> Completed / No-show changes made by the automated invoice
  -- reconciliation pipeline rather than a human agent, so they can be shown
  -- alongside agent-driven changes for a complete picture on the Agents tab.
  SELECT
    count(*) FILTER (WHERE old_value = 'Booked' AND new_value = 'Completed'),
    count(*) FILTER (WHERE old_value = 'Booked' AND new_value = 'No-show')
  INTO v_invoice_workflow_completed, v_invoice_workflow_no_show
  FROM appointment_status_changes
  WHERE field_changed = 'appointment_status'
    AND (changed_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN p_start_date AND p_end_date
    AND changed_by IN ('invoice_auto_sync_cron', 'invoice_identity_pipeline');

  WITH
  i AS (
    SELECT coalesce(agent_name,'Unassigned') agent_name,
      count(*) FILTER (WHERE NOT (coalesce(call_direction,'') ILIKE '%outgoing%')) AS incoming_cnt,
      count(*) FILTER (WHERE NOT (coalesce(call_direction,'') ILIKE '%outgoing%') AND lower(coalesce(lead_status,'')) IN ('appointment_booked','appointment done','appointment_done')) AS incoming_booked_cnt,
      count(*) FILTER (WHERE call_direction ILIKE '%outgoing%') AS outgoing_leads_cnt,
      count(*) FILTER (WHERE call_direction ILIKE '%outgoing%' AND lower(coalesce(lead_status,'')) IN ('appointment_booked','appointment done','appointment_done')) AS outgoing_leads_booked_cnt
    FROM mis_internal.executive_leads
    WHERE lead_date BETWEEN p_start_date AND p_end_date AND true
      
    GROUP BY coalesce(agent_name,'Unassigned')
  ),
  o AS (
    SELECT assigned_agent, count(*) AS cnt,
      count(*) FILTER (WHERE outcome_code IN ('reached','booked_appointment')) AS reached_cnt,
      count(*) FILTER (WHERE outcome_code = 'booked_appointment') AS booked_cnt
    FROM outgoing_call_attempts
    WHERE (called_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN p_start_date AND p_end_date AND status <> 'pending' AND assigned_agent IS NOT NULL
    GROUP BY assigned_agent
  ),
  outbound_outcomes AS (
    SELECT assigned_agent,
      jsonb_agg(jsonb_build_object('outcome', coalesce(nullif(outcome_code,''),'unspecified'), 'count', cnt) ORDER BY cnt DESC) AS outcomes
    FROM (
      SELECT assigned_agent, coalesce(nullif(outcome_code,''),'unspecified') AS outcome_code, count(*) AS cnt
      FROM outgoing_call_attempts
      WHERE (called_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN p_start_date AND p_end_date AND status <> 'pending' AND assigned_agent IS NOT NULL
      GROUP BY assigned_agent, coalesce(nullif(outcome_code,''),'unspecified')
    ) x
    GROUP BY assigned_agent
  ),
  c AS (
    SELECT coalesce(agent_name,'Unassigned') agent_name, count(*) AS cnt,
      count(*) FILTER (WHERE outcome = 'confirmed') AS confirmed_cnt
    FROM appointment_confirmation_calls
    WHERE (coalesce(called_at, created_at) AT TIME ZONE 'Asia/Dhaka')::date BETWEEN p_start_date AND p_end_date AND true
    GROUP BY coalesce(agent_name,'Unassigned')
  ),
  agent_appts AS (
    SELECT ca.id, ca.appointment_date, ca.appointment_status, ca.patient_id,ca.eligible,ca.attended,ca.explicit_no_show,
      CASE WHEN oca.id IS NOT NULL THEN 'outbound' ELSE 'lead' END AS via,
      coalesce(l.agent_name, oca.assigned_agent,'Unassigned') AS agent,
      public.call_kpi_patient_type_label(coalesce(l.patient_type, pt.patient_type)) AS patient_type_label
    FROM mis_internal.executive_appointments ca
    LEFT JOIN mis_internal.executive_leads l ON l.id = ca.lead_id
    LEFT JOIN outgoing_call_attempts oca ON oca.id = ca.outbound_attempt_id
    LEFT JOIN patients pt ON pt.id = ca.patient_id
    WHERE ca.appointment_date BETWEEN p_start_date AND p_end_date
  ),
  appts_agg AS (
    SELECT agent,
      count(*) AS appts_cnt,
      count(*) FILTER (WHERE eligible) AS eligible_cnt,
      count(*) FILTER (WHERE explicit_no_show) AS no_show_cnt
    FROM agent_appts
    WHERE agent IS NOT NULL
    GROUP BY agent
  ),
  outbound_appts_agg AS (
    SELECT agent,
      count(*) AS appts_cnt,
      count(*) FILTER (WHERE eligible) AS eligible_cnt,
      count(*) FILTER (WHERE attended) AS attended_cnt
    FROM agent_appts
    WHERE agent IS NOT NULL AND via = 'outbound'
    GROUP BY agent
  ),
  revenue AS (
 SELECT coalesce(l.agent_name,'Unassigned') agent,
 sum(r.revenue) FILTER(WHERE public.call_kpi_patient_type_label(l.patient_type)='New') revenue_new,
 sum(r.revenue) FILTER(WHERE public.call_kpi_patient_type_label(l.patient_type)<>'New') revenue_followup
 FROM mis_internal.executive_revenue r JOIN mis_internal.executive_leads l ON l.id::text=r.lead_id
 WHERE r.invoice_date BETWEEN p_start_date AND p_end_date GROUP BY coalesce(l.agent_name,'Unassigned')
 ),
  trend AS (
    SELECT coalesce(agent_name,'Unassigned') agent_name, lead_date AS d,
      count(*) AS leads_cnt,
      count(*) FILTER (WHERE lower(coalesce(lead_status,'')) IN ('appointment_booked','appointment done','appointment_done')) AS booked_cnt
    FROM mis_internal.executive_leads
    WHERE lead_date BETWEEN p_start_date AND p_end_date AND true
      
    GROUP BY coalesce(agent_name,'Unassigned'), lead_date
  ),
  trend_agg AS (
    SELECT coalesce(agent_name,'Unassigned') agent_name,
      jsonb_agg(jsonb_build_object('date', d, 'leads', leads_cnt, 'booked', booked_cnt) ORDER BY d) AS trend
    FROM trend
    GROUP BY coalesce(agent_name,'Unassigned')
  ),
  status_changes AS (
    SELECT changed_by AS agent,
      count(*) FILTER (WHERE old_value = 'Booked' AND new_value = 'Completed') AS booked_to_completed_cnt,
      count(*) FILTER (WHERE old_value = 'Booked' AND new_value = 'No-show') AS booked_to_no_show_cnt
    FROM appointment_status_changes
    WHERE field_changed = 'appointment_status'
      AND (changed_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN p_start_date AND p_end_date
      AND changed_by IS NOT NULL
      AND changed_by NOT IN ('invoice_auto_sync_cron', 'invoice_identity_pipeline')
    GROUP BY changed_by
  ),
  status_change_daily AS (
    SELECT changed_by AS agent, (changed_at AT TIME ZONE 'Asia/Dhaka')::date AS d,
      count(*) FILTER (WHERE old_value = 'Booked' AND new_value = 'Completed') AS booked_to_completed_cnt,
      count(*) FILTER (WHERE old_value = 'Booked' AND new_value = 'No-show') AS booked_to_no_show_cnt
    FROM appointment_status_changes
    WHERE field_changed = 'appointment_status'
      AND (changed_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN p_start_date AND p_end_date
      AND changed_by IS NOT NULL
      AND changed_by NOT IN ('invoice_auto_sync_cron', 'invoice_identity_pipeline')
    GROUP BY changed_by, (changed_at AT TIME ZONE 'Asia/Dhaka')::date
  ),
  status_change_daily_agg AS (
    SELECT agent,
      jsonb_agg(jsonb_build_object('date', d, 'booked_to_completed', booked_to_completed_cnt, 'booked_to_no_show', booked_to_no_show_cnt) ORDER BY d) AS daily
    FROM status_change_daily
    GROUP BY agent
  )
  SELECT jsonb_build_object(
    'period_start', p_start_date,
    'period_end', p_end_date,
    'total_patients_with_appointments', v_total_patients_with_appointments,
    'invoice_workflow_status_changes', jsonb_build_object(
      'booked_to_completed', coalesce(v_invoice_workflow_completed, 0),
      'booked_to_no_show', coalesce(v_invoice_workflow_no_show, 0)
    ),
    'agents', coalesce(jsonb_agg(jsonb_build_object(
      'agent', agent,
      'incoming', coalesce(incoming_cnt, 0),
      'incoming_booked', coalesce(incoming_booked_cnt, 0),
      'outgoing_leads', coalesce(outgoing_leads_cnt, 0),
      'outgoing_leads_booked', coalesce(outgoing_leads_booked_cnt, 0),
      'outbound', coalesce(outbound_cnt, 0),
      'outbound_reached', coalesce(outbound_reached_cnt, 0),
      'outbound_booked', coalesce(outbound_booked_cnt, 0),
      'outbound_outcomes', coalesce(outbound_outcomes_j, '[]'::jsonb),
      'outbound_appointments_set', coalesce(ob_appts_cnt, 0),
      'outbound_appointments_eligible', coalesce(ob_eligible_cnt, 0),
      'outbound_appointments_attended', coalesce(ob_attended_cnt, 0),
      'confirmation', coalesce(confirmation_cnt, 0),
      'confirmation_confirmed', coalesce(confirmation_confirmed_cnt, 0),
      'appointments_set', coalesce(appts_cnt, 0),
      'appointments_eligible',coalesce(eligible_cnt,0),
      'no_shows', coalesce(no_show_cnt, 0),
      'no_show_rate', round(100.0 * coalesce(no_show_cnt, 0) / NULLIF(eligible_cnt, 0), 1),
      'revenue_new', coalesce(rev_new, 0),
      'revenue_followup', coalesce(rev_followup, 0),
      'attempts_per_booking', CASE WHEN coalesce(outbound_booked_cnt, 0) > 0 THEN round(outbound_cnt::numeric / outbound_booked_cnt, 1) ELSE NULL END,
      'trend', coalesce(agent_trend, '[]'::jsonb),
      'booked_to_completed', coalesce(booked_to_completed_cnt, 0),
      'booked_to_no_show', coalesce(booked_to_no_show_cnt, 0),
      'status_change_daily', coalesce(status_change_daily, '[]'::jsonb)
    ) ORDER BY coalesce(incoming_cnt, 0) + coalesce(outgoing_leads_cnt, 0) + coalesce(outbound_cnt, 0) DESC), '[]'::jsonb)
  ) INTO v_result
  FROM (
    SELECT
      k.agent AS agent,
      i.incoming_cnt, i.incoming_booked_cnt, i.outgoing_leads_cnt, i.outgoing_leads_booked_cnt,
      o.cnt AS outbound_cnt, o.reached_cnt AS outbound_reached_cnt, o.booked_cnt AS outbound_booked_cnt,
      oo.outcomes AS outbound_outcomes_j,
      c.cnt AS confirmation_cnt, c.confirmed_cnt AS confirmation_confirmed_cnt,
      a.appts_cnt, a.eligible_cnt, a.no_show_cnt,
      ob.appts_cnt AS ob_appts_cnt, ob.eligible_cnt AS ob_eligible_cnt, ob.attended_cnt AS ob_attended_cnt,
      r.revenue_new AS rev_new, r.revenue_followup AS rev_followup,
      t.trend AS agent_trend,
      sc.booked_to_completed_cnt, sc.booked_to_no_show_cnt,
      scd.daily AS status_change_daily
    FROM (
      SELECT agent_name agent FROM i UNION SELECT assigned_agent FROM o UNION SELECT agent_name FROM c
      UNION SELECT agent FROM appts_agg UNION SELECT agent FROM status_changes UNION SELECT agent FROM revenue
    ) k
    LEFT JOIN i ON i.agent_name=k.agent
    LEFT JOIN o ON o.assigned_agent=k.agent
    LEFT JOIN c ON c.agent_name=k.agent
    LEFT JOIN appts_agg a ON a.agent=k.agent
    LEFT JOIN status_changes sc ON sc.agent=k.agent
    LEFT JOIN outbound_outcomes oo ON oo.assigned_agent=k.agent
    LEFT JOIN outbound_appts_agg ob ON ob.agent=k.agent
    LEFT JOIN revenue r ON r.agent=k.agent
    LEFT JOIN trend_agg t ON t.agent_name=k.agent
    LEFT JOIN status_change_daily_agg scd ON scd.agent=k.agent
    WHERE k.agent IS NOT NULL
  ) x;

  RETURN v_result;
END;
$function$

;
CREATE OR REPLACE FUNCTION mis_internal.executive_ads(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'mis_internal'
AS $function$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=auth.uid() AND role='admin' AND is_active) THEN
  RAISE EXCEPTION 'Admin access required.'; END IF;
 WITH leads AS (
  SELECT a.meta_campaign_id campaign_id,a.meta_ad_id ad_id,max(a.meta_ad_name) ad_name,max(a.meta_campaign_name) campaign_name,
   count(distinct l.id) leads,count(distinct l.id) FILTER(WHERE EXISTS(SELECT 1 FROM public.crm_appointments p WHERE p.lead_id=l.id)) booked
  FROM public.lead_attribution a JOIN mis_internal.executive_leads l ON l.id=a.lead_id
  WHERE a.meta_campaign_id IS NOT NULL AND l.lead_date BETWEEN p_start_date AND p_end_date
  GROUP BY 1,2
 ), appointments AS (
  SELECT a.meta_campaign_id campaign_id,a.meta_ad_id ad_id,count(distinct p.id) appointments,
   count(distinct p.id) FILTER(WHERE o.attended) completed
  FROM public.lead_attribution a JOIN public.crm_appointments p ON p.lead_id=a.lead_id
  LEFT JOIN mis_internal.executive_appointments o ON o.id=p.id
  WHERE a.meta_campaign_id IS NOT NULL AND p.appointment_date BETWEEN p_start_date AND p_end_date GROUP BY 1,2
 ), revenue AS (
  SELECT a.campaign_id,a.acquisition_ad_id ad_id,max(a.campaign_name) campaign_name,sum(i.net_bill) revenue
  FROM public.patient_marketing_attribution a JOIN public.invoices i ON i.patient_id=a.patient_id
  WHERE a.attribution_status='eligible_source' AND a.campaign_id IS NOT NULL
   AND i.invoice_date>=a.first_touch_date AND i.invoice_date BETWEEN p_start_date AND p_end_date
   AND i.reconciliation_status='matched' AND i.invoice_status NOT IN('void','cancelled') GROUP BY 1,2
 ), keys AS (
  SELECT campaign_id,ad_id FROM leads UNION SELECT campaign_id,ad_id FROM appointments UNION SELECT campaign_id,ad_id FROM revenue
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('campaign_id',k.campaign_id,'ad_id',k.ad_id,'ad_name',l.ad_name,
  'campaign_name',coalesce(l.campaign_name,r.campaign_name),'leads',coalesce(l.leads,0),'booked',coalesce(l.booked,0),
  'appointments',coalesce(p.appointments,0),'completed',coalesce(p.completed,0),'revenue',coalesce(r.revenue,0))
  ORDER BY coalesce(l.leads,0) DESC),'[]') INTO result
 FROM keys k LEFT JOIN leads l ON l.campaign_id=k.campaign_id AND l.ad_id IS NOT DISTINCT FROM k.ad_id
 LEFT JOIN appointments p ON p.campaign_id=k.campaign_id AND p.ad_id IS NOT DISTINCT FROM k.ad_id
 LEFT JOIN revenue r ON r.campaign_id=k.campaign_id AND r.ad_id IS NOT DISTINCT FROM k.ad_id;
 RETURN result;
END $function$

;
REVOKE ALL ON FUNCTION mis_internal.executive_overview(date,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION mis_internal.executive_sources(date,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION mis_internal.executive_agents(date,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION mis_internal.executive_ads(date,date) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_executive_dashboard(p_start_date date,p_end_date date,p_compare boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_current jsonb;v_previous jsonb;v_sources jsonb;v_days integer;v_reconciliation jsonb;
BEGIN
 IF NOT coalesce(public.is_admin(),false) THEN RAISE EXCEPTION 'Admin access required.' USING ERRCODE='42501'; END IF;
 IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date<p_start_date OR p_end_date-p_start_date>365 THEN
 RAISE EXCEPTION 'Select a valid reporting period of at most 366 days.' USING ERRCODE='22023'; END IF;
 v_days:=p_end_date-p_start_date+1;
 v_current:=mis_internal.executive_overview(p_start_date,p_end_date);
 IF p_compare THEN v_previous:=mis_internal.executive_overview(p_start_date-v_days,p_start_date-1); END IF;
 v_sources:=mis_internal.executive_sources(p_start_date,p_end_date);
 SELECT jsonb_build_object('pending',mis_internal.gateway_publication_blocked(),
 'published_at',p.updated_at,'stage',p.stage,'batch_id',p.published_batch_id,'revision',p.marketing_revision,
 'crm_updated_at',(SELECT max(updated_at) FROM public.crm_leads),
 'billing_updated_at',(SELECT max(updated_at) FROM public.crm_billing_links))
 INTO v_reconciliation FROM mis_internal.mis_gateway_publication p WHERE singleton;
 RETURN jsonb_build_object('contract_version',2,'refreshed_at',statement_timestamp(),'timezone','Asia/Dhaka',
 'metrics',v_current || jsonb_build_object('revenue_scope',(
 SELECT jsonb_build_object('acquisition_ledger_total',coalesce(sum((x->>'revenue_new')::numeric+(x->>'revenue_followup')::numeric),0),
 'unattributed_acquisition',coalesce(sum((x->>'revenue_new')::numeric+(x->>'revenue_followup')::numeric) FILTER(WHERE x->>'source'='Unattributed / Historical'),0))
 FROM jsonb_array_elements(v_sources->'sources')x)),
 'previous',v_previous,'sources',v_sources,
 'agents',mis_internal.executive_agents(p_start_date,p_end_date),'ads',mis_internal.executive_ads(p_start_date,p_end_date),
 'reconciliation',v_reconciliation);
END; $$;
REVOKE ALL ON FUNCTION public.get_executive_dashboard(date,date,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_executive_dashboard(date,date,boolean) TO authenticated;
COMMENT ON FUNCTION public.get_executive_dashboard(date,date,boolean) IS 'Admin-only, read-only executive reporting contract v2. Current, comparison and detail reports use a single database snapshot and Asia/Dhaka dates. Max 366 days.';
NOTIFY pgrst,'reload schema';

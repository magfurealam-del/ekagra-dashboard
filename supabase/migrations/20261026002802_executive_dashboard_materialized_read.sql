-- Reuse each reporting population once per read; avoid correlated evidence scans.
CREATE OR REPLACE FUNCTION mis_internal.executive_overview(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'mis_internal'
 SET jit=off
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- Allow the nightly refresh_dashboard_metric_snapshot_cron job to call this via the
  -- service_role key (no auth.uid() context in that case) in addition to real admins.
  IF NOT (is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;

  WITH report_leads AS MATERIALIZED (SELECT * FROM mis_internal.executive_leads),
  report_appointments AS MATERIALIZED (SELECT * FROM mis_internal.executive_appointments),
  report_revenue AS MATERIALIZED (SELECT * FROM mis_internal.executive_revenue)
  SELECT jsonb_build_object(
    'period_start', p_start_date,
    'period_end', p_end_date,

    'total_leads', (SELECT count(*) FROM report_leads WHERE lead_date BETWEEN p_start_date AND p_end_date),
    'booked_leads', (SELECT count(*) FROM report_leads WHERE lead_date BETWEEN p_start_date AND p_end_date AND lower(coalesce(lead_status,'')) IN ('appointment_booked','appointment done','appointment_done')),
    'suppressed_leads', (SELECT count(*) FROM report_leads WHERE lead_date BETWEEN p_start_date AND p_end_date AND lead_status = 'suppressed'),

    'by_patient_type', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('type', t, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT public.call_kpi_patient_type_label(patient_type) AS t, count(*) AS cnt
        FROM report_leads WHERE lead_date BETWEEN p_start_date AND p_end_date
        GROUP BY 1
      ) x
    ),

    'by_source',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY count DESC),'[]') FROM (
 SELECT source_name source,count(*) count FROM report_leads WHERE lead_date BETWEEN p_start_date AND p_end_date GROUP BY 1)s),
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
        FROM report_leads WHERE lead_date BETWEEN p_start_date AND p_end_date
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
        FROM report_leads
        WHERE lead_date BETWEEN p_start_date AND p_end_date AND agent_name IS NOT NULL
        GROUP BY agent_name
      ) x
    ),

    'by_location', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('area', a, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (
        SELECT coalesce(NULLIF(trim(p.area), ''), 'Unspecified') AS a, count(*) AS cnt
        FROM report_leads l
        LEFT JOIN patients p ON p.id = l.patient_id
        WHERE l.lead_date BETWEEN p_start_date AND p_end_date
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 8
      ) x
    ),

    'total_appointments', (SELECT count(*) FROM crm_appointments WHERE appointment_date BETWEEN p_start_date AND p_end_date),

    'attended', (SELECT count(*) FROM report_appointments WHERE attended AND appointment_date BETWEEN p_start_date AND p_end_date),
    'no_shows', (SELECT count(*) FROM report_appointments WHERE explicit_no_show AND appointment_date BETWEEN p_start_date AND p_end_date),
    'cancelled', (SELECT count(*) FROM crm_appointments WHERE appointment_status='Cancelled' AND appointment_date BETWEEN p_start_date AND p_end_date),
    'show_rate', (SELECT round(100.0*count(*) FILTER(WHERE attended)/nullif(count(*) FILTER(WHERE eligible),0),1) FROM report_appointments WHERE appointment_date BETWEEN p_start_date AND p_end_date),
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
          (SELECT count(*) FROM report_leads WHERE lead_date = gs::date) AS leads_cnt,
          (SELECT count(*) FROM crm_appointments WHERE appointment_date = gs::date) AS appt_cnt
        FROM generate_series(p_start_date, p_end_date, interval '1 day') gs
      ) x
    ),

    'total_revenue',(SELECT coalesce(sum(revenue),0) FROM report_revenue WHERE invoice_date BETWEEN p_start_date AND p_end_date),
    'revenue_by_source',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY revenue DESC),'[]') FROM (
      SELECT l.source_name source,sum(b.revenue) revenue FROM report_revenue b
      JOIN report_leads l ON l.id::text=b.lead_id
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
  ) || jsonb_build_object(
    'contract_version',2,'timezone','Asia/Dhaka',
    'mis_verified_attended',(SELECT count(*) FROM report_appointments WHERE attended AND appointment_date BETWEEN p_start_date AND p_end_date),
    'explicit_crm_no_shows',(SELECT count(*) FROM report_appointments WHERE explicit_no_show AND appointment_date BETWEEN p_start_date AND p_end_date),
    'completed_appointments_without_mis_visit_proof',(SELECT count(*) FROM report_appointments WHERE eligible AND appointment_status='Completed' AND NOT verified AND appointment_date BETWEEN p_start_date AND p_end_date),
    'attendance',(SELECT jsonb_build_object(
      'eligible',count(*) FILTER(WHERE eligible),'verified',count(*) FILTER(WHERE attended),
      'explicit_no_show',count(*) FILTER(WHERE explicit_no_show),
      'unresolved',count(*) FILTER(WHERE eligible AND NOT attended AND NOT explicit_no_show),
      'excluded',count(*) FILTER(WHERE coalesce(appointment_status,'') IN ('Cancelled','Rescheduled')),
      'awaiting_maturity',count(*) FILTER(WHERE NOT eligible AND coalesce(appointment_status,'') NOT IN ('Cancelled','Rescheduled')),
      'evidence_conflicts',count(*) FILTER(WHERE evidence_conflict),
      'eligible_through',(statement_timestamp() AT TIME ZONE 'Asia/Dhaka')::date-2,
      'grace_full_days',1,'no_charge_evidence_available',false)
      FROM report_appointments WHERE appointment_date BETWEEN p_start_date AND p_end_date),
    'lead_cohort',(SELECT jsonb_build_object('leads',count(*),
      'with_appointment',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM crm_appointments a WHERE a.lead_id=l.id AND a.appointment_status NOT IN ('Cancelled','Rescheduled'))),
      'with_verified_visit',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM report_appointments a WHERE a.lead_id=l.id AND a.attended)))
      FROM report_leads l WHERE lead_date BETWEEN p_start_date AND p_end_date),
    'validation',jsonb_build_object(
      'attributed_invoice_count',(SELECT count(*) FROM report_revenue WHERE invoice_date BETWEEN p_start_date AND p_end_date),
      'attributed_leads',(SELECT count(*) FROM report_leads WHERE lead_date BETWEEN p_start_date AND p_end_date AND source_name<>'Unknown'),
      'approved_invoice_matches',(SELECT count(*) FROM public.crm_invoice_reconciliation WHERE match_status IN ('matched','approved_auto') AND invoice_date BETWEEN p_start_date AND p_end_date),
      'invoice_matches_needing_review',(SELECT count(*) FROM public.crm_invoice_reconciliation WHERE match_status LIKE 'needs_review%' AND invoice_date BETWEEN p_start_date AND p_end_date))
  ) INTO v_result;
  RETURN v_result;
END;
$function$

;

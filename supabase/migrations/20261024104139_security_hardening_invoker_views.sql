-- Harden all advisor-flagged views so underlying table permissions and RLS
-- are checked as the caller. The application relies on these three views.
ALTER VIEW public.daily_callback_queue SET (security_invoker = true);
ALTER VIEW public.patient_search_view SET (security_invoker = true);
ALTER VIEW public.outgoing_call_today_metrics SET (security_invoker = true);
ALTER VIEW public.no_show_follow_up_queue_view SET (security_invoker = true);
ALTER VIEW public.outgoing_call_funnel_metrics SET (security_invoker = true);
ALTER VIEW public.validated_appointments SET (security_invoker = true);
ALTER VIEW public.outgoing_call_all_attempts_view SET (security_invoker = true);
ALTER VIEW public.day_detail_appointments_view SET (security_invoker = true);
ALTER VIEW public.calendar_day_summary SET (security_invoker = true);
ALTER VIEW public.v_unified_call_center_activity SET (security_invoker = true);
ALTER VIEW public.v_call_center_cross_source_duplicate_review SET (security_invoker = true);
ALTER VIEW public.calendar_tomorrow_kpi SET (security_invoker = true);
ALTER VIEW public.patient_master_view SET (security_invoker = true);
ALTER VIEW public.appointment_patient_resolution SET (security_invoker = true);
ALTER VIEW public.outgoing_call_history_view SET (security_invoker = true);
ALTER VIEW public.calendar_day_type_summary SET (security_invoker = true);
ALTER VIEW public.outgoing_call_agent_performance SET (security_invoker = true);
ALTER VIEW public.calendar_summary_view SET (security_invoker = true);
ALTER VIEW public.today_appointments_view SET (security_invoker = true);
ALTER VIEW public.calendar_agent_performance_today SET (security_invoker = true);
ALTER VIEW public.outgoing_call_sheet_view SET (security_invoker = true);
ALTER VIEW public.calendar_call_center_today SET (security_invoker = true);
ALTER VIEW public.meta_offline_export_dashboard SET (security_invoker = true);
ALTER VIEW public.meta_offline_revenue_attribution_summary SET (security_invoker = true);
ALTER VIEW public.doctor_visit_summary SET (security_invoker = true);
ALTER VIEW public.patient_visit_summary SET (security_invoker = true);
ALTER VIEW public.vw_lead_outcomes SET (security_invoker = true);
ALTER VIEW public.vw_marketing_executive_summary SET (security_invoker = true);
ALTER VIEW public.vw_funnel_by_bucket SET (security_invoker = true);
ALTER VIEW public.vw_ad_performance_with_crm SET (security_invoker = true);
ALTER VIEW public.vw_call_center_marketing_outcomes SET (security_invoker = true);
ALTER VIEW public.vw_no_show_recovery_queue SET (security_invoker = true);
ALTER VIEW public.vw_marketing_data_quality SET (security_invoker = true);
ALTER VIEW public.v_unified_call_center_activity_deduped SET (security_invoker = true);
ALTER VIEW public.calendar_appointment_detail SET (security_invoker = true);

GRANT SELECT ON public.patient_master_view,
  public.outgoing_call_sheet_view,
  public.outgoing_call_today_metrics TO authenticated;


-- Public-schema functions become private by default, including invoker
-- functions that otherwise inherit EXECUTE from PUBLIC. The server service
-- role retains execution; only the application RPC allowlist below is
-- re-granted to authenticated users.
DO $function_acl$
DECLARE
  v_function record;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_function.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_function.signature);
  END LOOP;
END;
$function_acl$;

-- RLS policy helpers and app RPCs. Their bodies enforce active-staff/admin
-- checks; the sensitive lookup/write RPCs receive explicit guards below.
GRANT EXECUTE ON FUNCTION public.is_active_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_call_attempt_outcome(bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_call_center_kpis_fast(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_call_kpi_invoice_match(integer, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ad_attribution_report(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_agent_performance(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_source_performance(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_dashboard_metric_snapshot(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_doctor_daily_availability(text, date, boolean, time, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_doctor_daily_availability(text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_login_history(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_doctor_schedules(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_hospital_patient_id(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_recent_duplicate_lead(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_lead_intake(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_patient_by_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.book_appointment_from_call(bigint, date, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_or_update_appointment_patient(bigint, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_call_attempt_outcome(bigint, text, text, text, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_call_attempt_outcome(bigint, text, text, text, boolean, integer, text, text, timestamptz, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_confirmation_call(bigint, integer, text, text, text, smallint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_appointment(bigint, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_confirmation_call(bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_appointment_status(bigint, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_patient_contact_info(integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_patient_hn(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_appointment_status_from_invoices(boolean, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_scheduled_agent(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_password_change() TO authenticated;

-- SECURITY DEFINER search/intake functions return or mutate patient data.
-- Require an active staff identity even if called directly through PostgREST.
DO $staff_guards$
DECLARE
  v_signature regprocedure;
  v_definition text;
  v_marker text := E'\nBEGIN\n';
  v_guard text := E'\nBEGIN\n  IF auth.uid() IS NULL OR NOT public.is_active_staff() THEN\n    RAISE EXCEPTION ''active staff authentication required'' USING ERRCODE = ''42501'';\n  END IF;\n';
  v_position integer;
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'public.search_patient_by_phone(text)',
    'public.check_recent_duplicate_lead(text,integer)',
    'public.save_lead_intake(jsonb)',
    'public.update_hospital_patient_id(integer,text)',
    'public.book_appointment_from_call(bigint,date,text,text,text,text,text)',
    'public.link_or_update_appointment_patient(bigint,text,text,text)',
    'public.record_call_attempt_outcome(bigint,text,text,text,boolean,integer)',
    'public.record_call_attempt_outcome(bigint,text,text,text,boolean,integer,text,text,timestamptz,boolean)',
    'public.record_confirmation_call(bigint,integer,text,text,text,smallint,text)',
    'public.reschedule_appointment(bigint,date,text)',
    'public.reverse_confirmation_call(bigint,text,text)',
    'public.update_appointment_status(bigint,text,text,text)',
    'public.update_patient_contact_info(integer,text,text)',
    'public.update_patient_hn(integer,text)'
  ] LOOP
    v_signature := v_name::regprocedure;
    v_definition := pg_get_functiondef(v_signature);
    v_position := strpos(v_definition, v_marker);
    IF v_position = 0 THEN
      RAISE EXCEPTION 'Could not locate PL/pgSQL BEGIN marker for %', v_name;
    END IF;
    v_definition := overlay(v_definition placing v_guard from v_position for length(v_marker));
    EXECUTE v_definition;
  END LOOP;
END;
$staff_guards$;


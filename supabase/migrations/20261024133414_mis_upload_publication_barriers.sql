-- Preserve every existing schedule. Existing publication routines defer while
-- gateway work is incomplete; gateway calls use a transaction-local override
-- only after the queue has drained. No caller-controlled RPC argument can bypass it.
CREATE FUNCTION mis_internal.gateway_publication_blocked() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 SELECT EXISTS(SELECT 1 FROM mis_internal.mis_gateway_jobs WHERE status IN ('pending','failed'))
 OR (COALESCE(current_setting('app.mis_gateway_publish',true),'')<>'on' AND EXISTS(
  SELECT 1 FROM mis_internal.mis_gateway_publication WHERE published_batch_id < COALESCE((SELECT max(id) FROM mis_internal.mis_gateway_batches),0)));
$f$;
REVOKE ALL ON FUNCTION mis_internal.gateway_publication_blocked() FROM PUBLIC,anon,authenticated,service_role;
DO $guard$
DECLARE sig text; src text; guarded text;
BEGIN
 FOREACH sig IN ARRAY ARRAY[
  'mis_internal.finalize_nightly_crm_reconciliation(text,integer)',
  'mis_internal.refresh_shadow_lifetime_attribution()',
  'mis_internal.refresh_crm_contact_history_v2()',
  'mis_internal.refresh_dashboard_snapshot_tick(integer)',
  'public.refresh_dashboard_metric_snapshot(date,date)',
  'public.refresh_dashboard_metric_snapshot_cron(date,date)'
 ] LOOP
  src:=pg_get_functiondef(sig::regprocedure);
  IF src NOT LIKE '%gateway_publication_blocked%' THEN
   guarded:=regexp_replace(src,E'\\mbegin\\M',E'begin\n IF mis_internal.gateway_publication_blocked() THEN RETURN jsonb_build_object(''status'',''deferred_gateway''); END IF;','i');
   IF guarded=src THEN RAISE EXCEPTION 'Cannot safely add publication barrier to %',sig; END IF;
   EXECUTE guarded;
  END IF;
 END LOOP;
END $guard$;

-- The legacy 45-day cron used a -1/+3-day billing window, changed No-show
-- bookings and inferred absence from missing invoices. It must not undo the
-- gateway's exact clinical evidence policy after the overnight run.
CREATE OR REPLACE FUNCTION public._sync_appointment_status_from_invoices_core(
 p_only_pending boolean,p_since_date date,p_source_tag text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE a record; r jsonb; n integer:=0;
BEGIN
 IF COALESCE(auth.role(),'')<>'service_role' AND NOT public.is_admin() THEN
  RAISE EXCEPTION 'administrator required' USING ERRCODE='42501';
 END IF;
 IF mis_internal.gateway_publication_blocked() OR NOT pg_try_advisory_xact_lock(806731,7100) THEN RETURN 0; END IF;
 FOR a IN SELECT id FROM public.crm_appointments
  WHERE patient_id IS NOT NULL AND visit_verified IS DISTINCT FROM true
   AND appointment_status NOT IN ('Cancelled','No-show','Rescheduled')
   AND (p_since_date IS NULL OR appointment_date>=p_since_date)
   AND (NOT p_only_pending OR appointment_status IN ('Booked','Scheduled'))
  ORDER BY appointment_date,id LIMIT 1000 LOOP
  r:=mis_internal.gateway_verify_appointment(a.id);
  IF r->>'result'='verified' THEN n:=n+1; END IF;
 END LOOP;
 RETURN n;
END $f$;
REVOKE ALL ON FUNCTION public._sync_appointment_status_from_invoices_core(boolean,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._sync_appointment_status_from_invoices_core(boolean,date,text) TO service_role;

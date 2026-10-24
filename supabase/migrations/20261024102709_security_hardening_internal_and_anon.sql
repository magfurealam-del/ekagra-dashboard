-- Close anonymous data paths and make staff access depend on an active profile.
-- Website booking remains limited to its explicit insert policies and public
-- read-only doctor/time-slot lookup tables.

-- Internal MIS tables are private implementation details. Remove API schema
-- access and enable RLS as defense in depth; privileged SECURITY DEFINER RPCs
-- continue to run as their owner, while service_role keeps schema usage for
-- the reviewed admin RPC wrappers.
REVOKE USAGE ON SCHEMA mis_internal FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA mis_internal TO service_role;

-- The client-facing password-change wrapper is the only authenticated entry
-- point into mis_internal. Its target checks auth.uid() before changing the
-- caller's own profile, so keep the wrapper privileged and the schema private.
CREATE OR REPLACE FUNCTION public.complete_password_change()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM mis_internal.complete_password_change();
END;
$function$;

DO $internal_function_acl$
DECLARE
  v_function record;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'mis_internal'
       AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_function.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_function.signature);
  END LOOP;
END;
$internal_function_acl$;

ALTER TABLE mis_internal.batch_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.batch_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.manual_reconciliation_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.manual_reconciliation_authorizations FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.manual_reconciliation_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.manual_reconciliation_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.downstream_repair_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.downstream_repair_queue FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.downstream_repair_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.downstream_repair_exceptions FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.crm_conversion_repair_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.crm_conversion_repair_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.crm_nightly_finalizer_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.crm_nightly_finalizer_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.crm_lead_reconciliation_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.crm_lead_reconciliation_assessments FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.crm_attendance_verification_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.crm_attendance_verification_corrections FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.shadow_attribution_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.shadow_attribution_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.shadow_invoice_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.shadow_invoice_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.shadow_encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.shadow_encounters FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.shadow_patient_acquisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.shadow_patient_acquisitions FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.shadow_invoice_attribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.shadow_invoice_attribution FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.shadow_appointment_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.shadow_appointment_outcomes FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.crm_contact_history_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.crm_contact_history_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.crm_contact_history_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.crm_contact_history_v2 FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.mis_pipeline_health_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.mis_pipeline_health_audit FORCE ROW LEVEL SECURITY;

-- Drop permissive anonymous policies except the narrow website booking inserts
-- and public read-only reference data needed by the booking flow.
DO $policy_cleanup$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND 'anon' = ANY (roles)
       AND policyname NOT LIKE 'deny_anon%'
       AND policyname NOT IN ('public_website_booking_insert', 'public_website_interest_insert')
       AND NOT (
         tablename IN ('lookup_doctors', 'lookup_appointment_statuses', 'lookup_appointment_time_slots')
         AND policyname = 'anon_read'
         AND cmd = 'SELECT'
       )
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', v_policy.policyname, v_policy.schemaname, v_policy.tablename);
  END LOOP;
END;
$policy_cleanup$;


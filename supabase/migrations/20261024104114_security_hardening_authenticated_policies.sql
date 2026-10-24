-- Broad policies limited to every authenticated caller still allow disabled
-- or unprovisioned accounts to read and change protected clinic data. Narrow
-- those policies to the same active-profile boundary used by the app.
DO $authenticated_policy_hardening$
DECLARE
  v_policy record;
  v_sql text;
BEGIN
  FOR v_policy IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND 'authenticated' = ANY (roles)
       AND (
         coalesce(qual, '') IN ('true', '(true)')
         OR coalesce(with_check, '') IN ('true', '(true)')
       )
  LOOP
    v_sql := format('ALTER POLICY %I ON %I.%I',
      v_policy.policyname, v_policy.schemaname, v_policy.tablename);
    IF v_policy.cmd IN ('SELECT', 'UPDATE', 'DELETE', 'ALL')
       AND coalesce(v_policy.qual, '') IN ('true', '(true)') THEN
      v_sql := v_sql || ' USING (public.is_active_staff())';
    END IF;
    IF v_policy.cmd IN ('INSERT', 'UPDATE', 'ALL')
       AND coalesce(v_policy.with_check, '') IN ('true', '(true)') THEN
      v_sql := v_sql || ' WITH CHECK (public.is_active_staff())';
    END IF;
    EXECUTE v_sql;
  END LOOP;
END;
$authenticated_policy_hardening$;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Public website is permitted to read only public booking reference data and
-- insert only rows constrained by the existing website RLS policies.
GRANT SELECT ON public.lookup_doctors,
  public.lookup_appointment_statuses,
  public.lookup_appointment_time_slots TO anon;
GRANT INSERT ON public.crm_appointments, public.crm_leads TO anon;
DO $booking_sequences$
DECLARE
  v_sequence text;
BEGIN
  v_sequence := pg_get_serial_sequence('public.crm_appointments', 'id');
  IF v_sequence IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO anon', v_sequence);
  END IF;
  v_sequence := pg_get_serial_sequence('public.crm_leads', 'id');
  IF v_sequence IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO anon', v_sequence);
  END IF;
END;
$booking_sequences$;

-- Replace unrestricted queue access with the active-staff policy.
DROP POLICY IF EXISTS allow_all_outgoing_call_attempts ON public.outgoing_call_attempts;
DROP POLICY IF EXISTS allow_all_outgoing_call_queue ON public.outgoing_call_queue;
DROP POLICY IF EXISTS allow_all_outgoing_call_schedule_config ON public.outgoing_call_schedule_config;
CREATE POLICY staff_all_outgoing_call_attempts
  ON public.outgoing_call_attempts FOR ALL TO authenticated
  USING (public.is_active_staff()) WITH CHECK (public.is_active_staff());
CREATE POLICY staff_all_outgoing_call_queue
  ON public.outgoing_call_queue FOR ALL TO authenticated
  USING (public.is_active_staff()) WITH CHECK (public.is_active_staff());
CREATE POLICY staff_all_outgoing_call_schedule_config
  ON public.outgoing_call_schedule_config FOR ALL TO authenticated
  USING (public.is_active_staff()) WITH CHECK (public.is_active_staff());

-- Remove permissive all-authenticated patient policies; keep the existing
-- active-staff policy as the single patient access path.
DROP POLICY IF EXISTS patients_auth_read ON public.patients;
DROP POLICY IF EXISTS patients_auth_update ON public.patients;
DROP POLICY IF EXISTS patients_auth_write ON public.patients;

-- Invoice rows are needed by the patient summary view. Expose them only to
-- active staff and let security-invoker views honor these policies.
DROP POLICY IF EXISTS authenticated_read_invoices ON public.invoices;
DROP POLICY IF EXISTS authenticated_read_invoice_line_items ON public.invoice_line_items;
CREATE POLICY active_staff_read_invoices
  ON public.invoices FOR SELECT TO authenticated
  USING (public.is_active_staff());
CREATE POLICY active_staff_read_invoice_line_items
  ON public.invoice_line_items FOR SELECT TO authenticated
  USING (public.is_active_staff());
GRANT SELECT ON public.invoices, public.invoice_line_items TO authenticated;

-- Profile data is self-readable; administrators may read staff profiles for
-- management. The admin helper runs as its trusted owner and uses auth.uid().
DROP POLICY IF EXISTS user_profiles_read ON public.user_profiles;
CREATE POLICY user_profiles_self_or_admin_read
  ON public.user_profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR public.is_admin());

-- The legacy availability policy targeted PUBLIC. Limit it to active staff.
DROP POLICY IF EXISTS staff_all_doctor_daily_availability ON public.doctor_daily_availability;
CREATE POLICY staff_all_doctor_daily_availability
  ON public.doctor_daily_availability FOR ALL TO authenticated
  USING (public.is_active_staff()) WITH CHECK (public.is_active_staff());


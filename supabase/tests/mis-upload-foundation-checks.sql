-- Read-only post-migration assertions. Run against a disposable clone only.
-- This file does not insert fixtures or alter database state.
DO $checks$
DECLARE
  v_table text;
BEGIN
  IF has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated still has table-wide profile UPDATE';
  END IF;
  IF has_column_privilege('authenticated', 'public.user_profiles', 'role', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.user_profiles', 'is_active', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.user_profiles', 'must_change_password', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated can update a protected profile field';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.user_profiles', 'full_name', 'UPDATE') THEN
    RAISE EXCEPTION 'safe profile name update was removed';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.complete_password_change()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.complete_password_change()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'mis_internal.complete_password_change()', 'EXECUTE')
     OR has_function_privilege('anon', 'mis_internal.complete_password_change()', 'EXECUTE') THEN
    RAISE EXCEPTION 'password completion function grants are incorrect';
  END IF;
  IF (
    SELECT p.prosecdef FROM pg_proc p
    WHERE p.oid = 'public.complete_password_change()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'public password completion RPC must be SECURITY INVOKER';
  END IF;
  IF NOT (
    SELECT p.prosecdef FROM pg_proc p
    WHERE p.oid = 'mis_internal.complete_password_change()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'internal password completion implementation must be SECURITY DEFINER';
  END IF;
  IF NOT has_schema_privilege('authenticated', 'mis_internal', 'USAGE')
     OR has_schema_privilege('anon', 'mis_internal', 'USAGE')
     OR has_schema_privilege('service_role', 'mis_internal', 'USAGE') THEN
    RAISE EXCEPTION 'mis_internal schema usage grants are incorrect';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'mis_upload_files', 'mis_upload_state', 'mis_upload_attempts',
    'mis_upload_attempt_events', 'mis_upload_parses', 'mis_upload_rows',
    'mis_import_validations'
  ] LOOP
    IF NOT COALESCE((
      SELECT c.relrowsecurity AND c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'mis_internal' AND c.relname = v_table
    ), false) THEN
      RAISE EXCEPTION 'RLS is not enabled and forced for mis_internal.%', v_table;
    END IF;
    IF has_table_privilege('authenticated', format('mis_internal.%I', v_table), 'SELECT')
       OR has_table_privilege('authenticated', format('mis_internal.%I', v_table), 'INSERT')
       OR has_table_privilege('service_role', format('mis_internal.%I', v_table), 'INSERT') THEN
      RAISE EXCEPTION 'direct table access exists for mis_internal.%', v_table;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'mis_internal.mis_upload_files'::regclass
      AND tgname = 'mis_upload_files_append_only' AND tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'mis_internal.mis_upload_rows'::regclass
      AND tgname = 'mis_upload_rows_unsealed_parse_only' AND tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'mis_internal.mis_upload_parses'::regclass
      AND tgname = 'mis_upload_parses_seal_guard' AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'an immutable history trigger is missing or disabled';
  END IF;

  IF (
    SELECT count(*) FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'mis_internal'
      AND t.tgname IN (
        'mis_upload_files_append_only',
        'mis_upload_attempts_append_only',
        'mis_upload_attempt_events_append_only',
        'mis_upload_rows_append_only',
        'mis_import_validations_append_only',
        'mis_upload_rows_unsealed_parse_only',
        'mis_upload_parses_seal_guard'
      )
      AND t.tgenabled <> 'D'
  ) <> 7 THEN
    RAISE EXCEPTION 'expected seven enabled append/seal guards';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('mis_reports', 'mis_report_imports')
      AND t.tgname LIKE 'mis_upload%'
  ) THEN
    RAISE EXCEPTION 'gateway migration attached a trigger to canonical MIS tables';
  END IF;
END;
$checks$;

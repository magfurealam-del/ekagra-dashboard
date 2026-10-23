-- This migration hardens the authenticated profile API. It deliberately does
-- not change existing profile rows, auth users, or RLS read behavior.

REVOKE ALL PRIVILEGES ON TABLE public.user_profiles FROM anon, authenticated;

-- Clear any earlier per-column grants as well as table-level UPDATE.
REVOKE UPDATE (
  id,
  full_name,
  email,
  role,
  is_active,
  created_at,
  updated_at,
  must_change_password
) ON TABLE public.user_profiles FROM anon, authenticated;

GRANT SELECT ON TABLE public.user_profiles TO authenticated;
GRANT UPDATE (full_name) ON TABLE public.user_profiles TO authenticated;

-- Keep privileged code in the non-exposed internal schema. The public RPC is
-- an invoker wrapper so the PostgREST endpoint itself does not run as owner.
CREATE SCHEMA IF NOT EXISTS mis_internal;
-- Preserve any pre-existing service-role schema access. The new private RPCs
-- grant only the specific function EXECUTE rights they need below.
REVOKE ALL ON SCHEMA mis_internal FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA mis_internal TO authenticated;

CREATE OR REPLACE FUNCTION mis_internal.complete_password_change()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_profiles
     SET must_change_password = false
   WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION mis_internal.complete_password_change() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mis_internal.complete_password_change() TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_password_change()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  PERFORM mis_internal.complete_password_change();
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_password_change() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_password_change() TO authenticated;

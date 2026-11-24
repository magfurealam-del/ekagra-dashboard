-- An administrator-requested force sync may run in bounded invoice chunks
-- outside the overnight import window. The ordinary cron/drain path remains
-- constrained to the existing Dhaka overnight schedule.
DO $migration$
DECLARE
  definition text;
  anchor text := 'IF NOT mis_internal.is_overnight() AND NOT (';
  replacement text := $replacement$IF NOT mis_internal.is_overnight()
    AND COALESCE(current_setting('app.mis_force_daytime', true), 'false') <> 'true'
    AND NOT ($replacement$;
BEGIN
  SELECT pg_get_functiondef('mis_internal.mis_gateway_tick()'::regprocedure)
  INTO definition;
  IF position(anchor IN definition) = 0 THEN
    RAISE EXCEPTION 'MIS gateway tick schedule guard changed; refusing unsafe rewrite';
  END IF;
  EXECUTE replace(definition, anchor, replacement);
END
$migration$;

-- The service-role-only overload lets the trusted admin API request the
-- daytime override. Existing no-argument cron callers remain unchanged.
CREATE OR REPLACE FUNCTION public.mis_gateway_tick(p_force_daytime boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  PERFORM set_config('app.mis_force_daytime', COALESCE(p_force_daytime, false)::text, true);
  RETURN mis_internal.mis_gateway_tick();
END
$function$;

REVOKE ALL ON FUNCTION public.mis_gateway_tick(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mis_gateway_tick(boolean) TO service_role;

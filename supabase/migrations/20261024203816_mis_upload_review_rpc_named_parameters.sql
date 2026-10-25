-- PostgREST requires input parameter names when an RPC is called with a JSON object.
-- The original invoker wrapper had unnamed UUID inputs, so the authenticated admin
-- review endpoint received PGRST202 even though the function existed in PostgreSQL.
DROP FUNCTION public.get_mis_upload_review(uuid, uuid);

CREATE FUNCTION public.get_mis_upload_review(p_actor_id uuid,p_upload_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT mis_internal.get_mis_upload_review(p_actor_id, p_upload_id);
$function$;

REVOKE ALL ON FUNCTION public.get_mis_upload_review(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mis_upload_review(uuid, uuid)
  TO service_role;

-- Circuit breaker: many identical text-to-type errors in the active batch
-- indicate a systemic issue. Stop before the rest of the invoices are marked
-- failed; the admin can inspect the per-invoice diagnostics and resume later.
DO $$
DECLARE
  definition text;
  anchor text := '  -- Do not process or publish a partially queued batch.';
  guard text := $guard$
  IF EXISTS (
    SELECT 1
    FROM mis_internal.mis_gateway_jobs
    WHERE batch_id=(SELECT max(id) FROM mis_internal.mis_gateway_batches)
      AND status='failed' AND error_code='22P02'
    GROUP BY batch_id
    HAVING count(*) >= 25
  ) THEN
    RETURN jsonb_build_object('status','paused_for_error_review','code','22P02');
  END IF;
$guard$;
BEGIN
  SELECT pg_get_functiondef('mis_internal.mis_gateway_tick()'::regprocedure)
  INTO definition;
  IF position(anchor IN definition)=0 THEN
    RAISE EXCEPTION 'MIS worker definition changed; circuit breaker anchor not found';
  END IF;
  EXECUTE replace(definition,anchor,anchor||E'\n'||guard);
END;
$$;

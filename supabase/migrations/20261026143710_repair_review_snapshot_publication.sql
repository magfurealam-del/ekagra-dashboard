-- The REST authenticator preloads safeupdate. Make the intentional replacement
-- of this derived review cache explicit; keep the delete/insert/publication in
-- one transaction and leave source invoices and review evidence untouched.
DO $patch$
DECLARE definition text; old_text text := 'DELETE FROM mis_internal.marketing_review_revenue_snapshot;';
BEGIN
 definition := pg_get_functiondef('mis_internal.refresh_marketing_review_snapshot()'::regprocedure);
 IF (length(definition)-length(replace(definition,old_text,'')))<>length(old_text) THEN
  RAISE EXCEPTION 'Expected one review snapshot replacement';
 END IF;
 EXECUTE replace(definition,old_text,'DELETE FROM mis_internal.marketing_review_revenue_snapshot WHERE true;');
END $patch$;

-- A source-only rebuild reuses the same canonical batch. A matching batch and
-- source revision are not sufficient: every downstream stage must finish.
DO $patch$
DECLARE r record; definition text; matches integer;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('mis_internal.mis_gateway_tick()',
   'pub.published_batch_id>=target AND pub.rules_version=',
   'pub.stage=''complete'' AND pub.published_batch_id>=target AND pub.rules_version='),
  ('mis_internal.mis_gateway_status(uuid,uuid)',
   '''published'',pub.published_batch_id>=b.id AND pub.rules_version=',
   '''published'',pub.stage=''complete'' AND pub.published_batch_id>=b.id AND pub.rules_version='),
  ('mis_internal.gateway_publication_blocked()',
   'WHERE p.published_batch_id<coalesce',
   'WHERE p.stage<>''complete'' OR p.published_batch_id<coalesce')
 ) p(signature,old_text,new_text) LOOP
  definition:=pg_catalog.pg_get_functiondef(r.signature::regprocedure);
  matches:=(length(definition)-length(replace(definition,r.old_text,'')))/length(r.old_text);
  IF matches<>1 THEN RAISE EXCEPTION 'Expected one completion guard in %; refusing patch',r.signature; END IF;
  EXECUTE replace(definition,r.old_text,r.new_text);
 END LOOP;
END $patch$;

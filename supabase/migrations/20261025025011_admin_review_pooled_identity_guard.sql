-- A pooled billing identity represents several people, not one acquisition.
CREATE FUNCTION mis_internal.marketing_review_is_pooled_identity(p_hn text,p_name text) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT upper(regexp_replace(coalesce(p_hn,''),'[^a-zA-Z0-9]','','g')) IN
  ('GC','GENERALCUSTOMER','GENERALPATIENT','CASHCUSTOMER','UNKNOWN','UNKNOWNPATIENT')
 OR coalesce(p_name,'') ~* '(general|cash|walk[ -]?in|unknown)[[:space:]]+(customer|patient)'
$$;
REVOKE ALL ON FUNCTION mis_internal.marketing_review_is_pooled_identity(text,text) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE definition text; marker text:=' IF p_version IS NULL OR p_version IS DISTINCT FROM mis_internal.marketing_review_case_version(p_kind,p_id) THEN';
BEGIN
 definition:=pg_get_functiondef('mis_internal.marketing_review_resolve(uuid,uuid,text,bigint,text,jsonb)'::regprocedure);
 IF cardinality(string_to_array(definition,marker))<>2 THEN RAISE EXCEPTION 'Review resolver patch precondition failed'; END IF;
 definition:=replace(definition,marker,$guard$
 IF (p_kind='revenue' AND v_action='verify_source' AND EXISTS(SELECT 1 FROM public.patients p WHERE p.id=p_id
    AND mis_internal.marketing_review_is_pooled_identity(p.hn,p.full_name)))
  OR (p_kind='meta' AND v_action IN('confirm','duplicate') AND EXISTS(SELECT 1 FROM public.crm_leads l
    JOIN public.patients p ON p.id=l.patient_id WHERE l.id=(p_payload->>'leadId')::bigint
     AND mis_internal.marketing_review_is_pooled_identity(p.hn,p.full_name))) THEN
  RAISE EXCEPTION 'Pooled customer accounts cannot receive one patient acquisition source. Establish individual hospital identities through verified intake or a corrected MIS import first' USING ERRCODE='22023';
 END IF;
$guard$||marker);
 EXECUTE definition;
END $patch$;

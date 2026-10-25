-- Private review history. No source messages, invoices or import history are deleted.
CREATE TABLE mis_internal.marketing_review_actions (
 request_id uuid PRIMARY KEY, actor_id uuid NOT NULL,
 case_kind text NOT NULL CHECK(case_kind IN ('meta','revenue')), case_id bigint NOT NULL,
 action text NOT NULL, payload_hash text NOT NULL, reason text NOT NULL,
 before_data jsonb NOT NULL, after_data jsonb NOT NULL, evidence jsonb NOT NULL,
 requested_revision bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_review_case_history ON mis_internal.marketing_review_actions(case_kind,case_id,created_at DESC);
CREATE TABLE mis_internal.marketing_review_source_versions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, patient_id integer NOT NULL REFERENCES public.patients(id),
 request_id uuid NOT NULL UNIQUE, active boolean NOT NULL,
 source text, event_date date, evidence_reference text NOT NULL,
 excluded_evidence jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(excluded_evidence)='array'),
 actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT active OR (source IN ('facebook','google','referral','doctor recommendation','organic_direct') AND event_date IS NOT NULL))
);
CREATE INDEX marketing_review_source_patient ON mis_internal.marketing_review_source_versions(patient_id,id DESC);
-- A stable queue survives the worker's staged replacement of lifetime caches.
CREATE TABLE mis_internal.marketing_review_revenue_snapshot (
 patient_id integer NOT NULL, reason text NOT NULL, invoice_count bigint NOT NULL, net_bill numeric NOT NULL,
 first_invoice_date date, last_invoice_date date, first_clinical_date date, source text, source_date date,
 run_id bigint NOT NULL, PRIMARY KEY(patient_id,reason)
);
CREATE TABLE mis_internal.marketing_review_snapshot_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), run_id bigint, source_revision bigint,
 refreshed_at timestamptz
);
INSERT INTO mis_internal.marketing_review_snapshot_state(singleton) VALUES(true);
DO $security$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['marketing_review_actions','marketing_review_source_versions','marketing_review_revenue_snapshot','marketing_review_snapshot_state'] LOOP
  EXECUTE format('ALTER TABLE mis_internal.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE mis_internal.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON mis_internal.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $security$;
CREATE TRIGGER immutable_marketing_review_actions BEFORE UPDATE OR DELETE ON mis_internal.marketing_review_actions
 FOR EACH ROW EXECUTE FUNCTION mis_internal.reject_marketing_observation_mutation();
CREATE TRIGGER immutable_marketing_review_sources BEFORE UPDATE OR DELETE ON mis_internal.marketing_review_source_versions
 FOR EACH ROW EXECUTE FUNCTION mis_internal.reject_marketing_observation_mutation();
CREATE TRIGGER marketing_review_source_dirty AFTER INSERT ON mis_internal.marketing_review_source_versions
 FOR EACH STATEMENT EXECUTE FUNCTION mis_internal.mark_marketing_evidence_dirty();

-- Preserve the original evidence rules and expose explicit, reversible corrections.
DO $view$ BEGIN
 EXECUTE 'CREATE VIEW mis_internal.marketing_source_evidence_before_review WITH(security_invoker=true) AS '
  || pg_get_viewdef('mis_internal.marketing_source_evidence_v2'::regclass,true);
END $view$;
CREATE VIEW mis_internal.marketing_review_current_sources WITH(security_invoker=true) AS
 SELECT DISTINCT ON (patient_id) * FROM mis_internal.marketing_review_source_versions ORDER BY patient_id,id DESC;
CREATE OR REPLACE VIEW mis_internal.marketing_source_evidence_v2 WITH(security_invoker=true) AS
 SELECT e.* FROM mis_internal.marketing_source_evidence_before_review e
 WHERE NOT EXISTS(SELECT 1 FROM mis_internal.marketing_review_current_sources c,
  jsonb_array_elements(c.excluded_evidence) x WHERE c.active AND c.patient_id=e.patient_id
   AND ((x->>'table'=e.evidence_table AND x->>'id'=e.evidence_id)
    -- Derived attribution rows must not resurrect a corrected original source.
    OR (e.evidence_table='lead_attribution' AND EXISTS(SELECT 1 FROM public.lead_attribution a
      LEFT JOIN public.crm_leads l ON l.id=a.lead_id WHERE a.id::text=e.evidence_id
      AND ((x->>'table'='crm_leads' AND a.lead_id::text=x->>'id')
       OR (x->>'table'='call_center_logs' AND (a.call_center_log_id::text=x->>'id'
        OR (l.source_system='migrated_call_center_logs' AND l.external_lead_id=x->>'id'))))))
    OR (e.evidence_table='crm_leads' AND x->>'table'='call_center_logs' AND EXISTS(SELECT 1 FROM public.crm_leads l
      WHERE l.id::text=e.evidence_id AND l.source_system='migrated_call_center_logs' AND l.external_lead_id=x->>'id'))))
 UNION ALL
 SELECT c.patient_id,c.source,c.event_date,'marketing_review_source_versions'::text,c.id::text,
  'administrator_verified_original_date'::text,true,false,false,110,1.0::numeric,
  NULL::text,NULL::text,NULL::text,'administrator_verified_original_evidence'::text
 FROM mis_internal.marketing_review_current_sources c WHERE c.active;
REVOKE ALL ON mis_internal.marketing_source_evidence_before_review,mis_internal.marketing_review_current_sources,
 mis_internal.marketing_source_evidence_v2 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION mis_internal.refresh_marketing_review_snapshot() RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run bigint; v_revision bigint;
BEGIN
 SELECT p.marketing_revision INTO v_revision FROM mis_internal.mis_gateway_publication p
 JOIN mis_internal.marketing_reconciliation_state s ON s.singleton AND s.revision=p.marketing_revision
 WHERE p.singleton AND p.stage='complete' AND p.rules_version='marketing_pipeline_v2'
  AND p.target_batch_id=p.published_batch_id;
 IF v_revision IS NULL THEN RETURN; END IF;
 SELECT id INTO v_run FROM mis_internal.shadow_attribution_runs WHERE status='completed'
  AND integrity_passed AND rule_version='source_evidence_v2' ORDER BY id DESC LIMIT 1;
 IF v_run IS NULL OR NOT EXISTS(SELECT 1 FROM mis_internal.shadow_invoice_attribution WHERE run_id=v_run)
  OR EXISTS(SELECT 1 FROM mis_internal.shadow_invoice_attribution WHERE run_id<>v_run)
  OR EXISTS(SELECT 1 FROM mis_internal.marketing_review_snapshot_state WHERE singleton AND run_id=v_run AND source_revision=v_revision)
 THEN RETURN; END IF;
 DELETE FROM mis_internal.marketing_review_revenue_snapshot;
 INSERT INTO mis_internal.marketing_review_revenue_snapshot
 SELECT a.patient_id,a.attribution_class,count(*),sum(a.net_bill),min(a.invoice_date),max(a.invoice_date),
  p.first_clinical_invoice_date,p.source,p.source_event_date,v_run
 FROM mis_internal.shadow_invoice_attribution a
 JOIN mis_internal.shadow_patient_acquisitions p ON p.patient_id=a.patient_id AND p.run_id=v_run
 WHERE a.run_id=v_run AND a.attributed_source IS NULL
 GROUP BY a.patient_id,a.attribution_class,p.first_clinical_invoice_date,p.source,p.source_event_date;
 UPDATE mis_internal.marketing_review_snapshot_state SET run_id=v_run,source_revision=v_revision,refreshed_at=now() WHERE singleton;
END $$;
CREATE FUNCTION mis_internal.marketing_review_publication_snapshot() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NEW.stage='complete' THEN PERFORM mis_internal.refresh_marketing_review_snapshot(); END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER marketing_review_publication_snapshot AFTER UPDATE ON mis_internal.mis_gateway_publication
 FOR EACH ROW EXECUTE FUNCTION mis_internal.marketing_review_publication_snapshot();
SELECT mis_internal.refresh_marketing_review_snapshot();

CREATE FUNCTION mis_internal.marketing_review_pipeline() RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('sourceRevision',s.revision,'publishedRevision',p.marketing_revision,
  'stage',p.stage,'inWindow',mis_internal.is_overnight(),
  'hasBatch',EXISTS(SELECT 1 FROM mis_internal.mis_gateway_batches),
  'current',p.stage='complete' AND p.marketing_revision=s.revision AND p.published_batch_id=p.target_batch_id
    AND p.rules_version='marketing_pipeline_v2' AND NOT EXISTS(SELECT 1 FROM mis_internal.mis_gateway_jobs WHERE status IN('pending','failed')),
  'snapshotAt',q.refreshed_at,'snapshotRevision',q.source_revision,
  'failedJobs',(SELECT count(*) FROM mis_internal.mis_gateway_jobs WHERE status='failed'))
 FROM mis_internal.marketing_reconciliation_state s
 LEFT JOIN mis_internal.mis_gateway_publication p ON p.singleton
 LEFT JOIN mis_internal.marketing_review_snapshot_state q ON q.singleton WHERE s.singleton
$$;
CREATE FUNCTION mis_internal.marketing_review_case_version(p_kind text,p_id bigint) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT md5(jsonb_build_object('kind',p_kind,'id',p_id,
 'action',(SELECT a.request_id FROM mis_internal.marketing_review_actions a WHERE a.case_kind=p_kind AND a.case_id=p_id ORDER BY created_at DESC,request_id DESC LIMIT 1),
 'case',CASE WHEN p_kind='meta' THEN
  (SELECT to_jsonb(r)||jsonb_build_object('candidate',to_jsonb(c),'contact',
   (SELECT to_jsonb(m) FROM public.messenger_contacts m WHERE m.psid=c.psid AND m.page_id=c.page_id),
   'messages',(SELECT md5(coalesce(jsonb_agg(jsonb_build_array(e.id,e.received_at,e.message_text,e.crm_lead_id,e.webhook_event_id) ORDER BY e.id)::text,'')) FROM public.messenger_events e WHERE e.psid=c.psid AND e.page_id=c.page_id),
   'siblings',(SELECT jsonb_agg(jsonb_build_array(sc.id,sc.phone_e164,sc.reconciliation_status,sr.selected_crm_lead_id) ORDER BY sc.id) FROM public.meta_message_phone_candidates sc LEFT JOIN public.meta_call_center_reconciliation sr ON sr.meta_candidate_id=sc.id WHERE sc.psid=c.psid AND sc.page_id=c.page_id))
   FROM public.meta_call_center_reconciliation r JOIN public.meta_message_phone_candidates c ON c.id=r.meta_candidate_id WHERE r.id=p_id)
 ELSE (SELECT jsonb_build_object('patient',to_jsonb(p),'sourceVersion',(SELECT id FROM mis_internal.marketing_review_current_sources c WHERE c.patient_id=p.id),
  'evidence',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.evidence_table,e.evidence_id) FROM mis_internal.marketing_source_evidence_v2 e WHERE e.patient_id=p.id),
  'invoices',(SELECT jsonb_agg(jsonb_build_array(i.id,i.invoice_date,i.net_bill,i.reconciliation_status) ORDER BY i.id) FROM public.invoices i WHERE i.patient_id=p.id)) FROM public.patients p WHERE p.id=p_id) END)::text)
$$;
CREATE FUNCTION mis_internal.marketing_review_lead_version(p_id bigint) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT md5(jsonb_build_object('lead',to_jsonb(l),'patient',to_jsonb(p))::text)
 FROM public.crm_leads l LEFT JOIN public.patients p ON p.id=l.patient_id WHERE l.id=p_id
$$;

CREATE FUNCTION mis_internal.marketing_review_read(p_actor_id uuid,p_kind text,p_id bigint DEFAULT NULL,
 p_page integer DEFAULT 0,p_filter text DEFAULT '',p_search text DEFAULT '') RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb; v_pipeline jsonb; v_review public.meta_call_center_reconciliation%rowtype;
 v_candidate public.meta_message_phone_candidates%rowtype; v_patient public.patients%rowtype;
BEGIN
 PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);
 IF coalesce(p_kind,'') NOT IN('meta','revenue','leads') OR p_page IS NULL OR p_page NOT BETWEEN 0 AND 10000 OR length(p_search)>100 OR length(p_filter)>100 THEN
  RAISE EXCEPTION 'Invalid review query' USING ERRCODE='22023'; END IF;
 v_pipeline:=mis_internal.marketing_review_pipeline();
 IF p_kind='leads' THEN
  IF length(btrim(p_search))<2 THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') INTO v_result FROM (
   SELECT l.id,l.patient_id,l.lead_name,l.phone,l.source,p.hn,p.full_name,
    mis_internal.marketing_review_lead_version(l.id) version
   FROM public.crm_leads l LEFT JOIN public.patients p ON p.id=l.patient_id
   WHERE l.id::text=p_search OR l.patient_id::text=p_search OR p.hn ILIKE '%'||p_search||'%'
    OR l.lead_name ILIKE '%'||p_search||'%' OR p.full_name ILIKE '%'||p_search||'%'
    OR l.phone ILIKE '%'||p_search||'%' OR l.phone_normalized ILIKE '%'||p_search||'%'
   ORDER BY l.patient_id IS NULL,l.id LIMIT 25)s;
  RETURN v_result;
 END IF;
 IF p_id IS NULL AND p_kind='meta' THEN
  WITH cases AS (
   SELECT r.id,c.id candidate_id,c.phone_e164,c.phone_last4,r.review_status,r.selected_crm_lead_id,
    c.first_seen_at,c.last_seen_at,c.direction_class,c.meta_campaign_name,
    coalesce(a.evidence->>'reason','not_yet_assessed') reason
   FROM public.meta_call_center_reconciliation r JOIN public.meta_message_phone_candidates c ON c.id=r.meta_candidate_id
   LEFT JOIN LATERAL (SELECT evidence FROM mis_internal.marketing_evidence_resolution_audit a
    WHERE a.kind='unresolved_meta_identity_assessment' AND a.row_id=r.id::text ORDER BY a.id DESC LIMIT 1)a ON true
  ), filtered AS(SELECT * FROM cases WHERE
   (p_filter='all' OR (p_filter='resolved' AND review_status NOT IN('unreviewed','needs_review'))
    OR (p_filter IN('','open') AND review_status IN('unreviewed','needs_review')) OR p_filter=reason OR p_filter=review_status)
   AND (p_search='' OR id::text=p_search OR candidate_id::text=p_search OR phone_e164 ILIKE '%'||p_search||'%'))
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT * FROM filtered ORDER BY first_seen_at,id LIMIT 25 OFFSET p_page*25)s),'[]'),
   'total',(SELECT count(*) FROM filtered),'open',(SELECT count(*) FROM cases WHERE review_status IN('unreviewed','needs_review')),
   'reasons',(SELECT coalesce(jsonb_object_agg(reason,n),'{}') FROM (SELECT reason,count(*) n FROM cases WHERE review_status IN('unreviewed','needs_review') GROUP BY reason)s)) INTO v_result;
 ELSIF p_id IS NULL THEN
  WITH cases AS (SELECT q.*,p.hn,p.full_name FROM mis_internal.marketing_review_revenue_snapshot q JOIN public.patients p ON p.id=q.patient_id),
  filtered AS(SELECT * FROM cases WHERE (p_filter='' OR reason=p_filter)
   AND (p_search='' OR patient_id::text=p_search OR hn ILIKE '%'||p_search||'%' OR full_name ILIKE '%'||p_search||'%'))
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT * FROM filtered ORDER BY net_bill DESC,patient_id,reason LIMIT 25 OFFSET p_page*25)s),'[]'),
   'total',(SELECT count(*) FROM filtered),'patients',(SELECT count(distinct patient_id) FROM cases),'netBill',(SELECT coalesce(sum(net_bill),0) FROM cases),
   'reasons',(SELECT coalesce(jsonb_object_agg(reason,n),'{}') FROM (SELECT reason,count(*) n FROM cases GROUP BY reason)s)) INTO v_result;
 ELSIF p_kind='meta' THEN
  SELECT * INTO v_review FROM public.meta_call_center_reconciliation WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO STRICT v_candidate FROM public.meta_message_phone_candidates WHERE id=v_review.meta_candidate_id;
  SELECT jsonb_build_object('case',to_jsonb(v_review),'candidate',to_jsonb(v_candidate),
   'assessment',(SELECT evidence FROM mis_internal.marketing_evidence_resolution_audit WHERE kind='unresolved_meta_identity_assessment' AND row_id=p_id::text ORDER BY id DESC LIMIT 1),
   'contact',(SELECT jsonb_build_object('id',m.id,'phone',m.phone,'convertedLeadId',m.converted_crm_lead_id) FROM public.messenger_contacts m WHERE m.psid=v_candidate.psid AND m.page_id=v_candidate.page_id),
   'messages',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM (
    SELECT e.id,e.message_text,e.received_at,e.crm_lead_id,e.id=ANY(v_candidate.source_event_ids) candidate_evidence,
     coalesce(w.raw_event->'sender'->>'id'=v_candidate.psid AND w.raw_event->'recipient'->>'id'=v_candidate.page_id
      AND coalesce(w.raw_event->'message'->>'is_echo','false')='false',false) native_inbound
    FROM public.messenger_events e LEFT JOIN public.meta_webhook_events w ON w.id=e.webhook_event_id
    WHERE e.psid=v_candidate.psid AND e.page_id=v_candidate.page_id
    ORDER BY coalesce(e.id=ANY(v_candidate.source_event_ids),false) DESC,e.received_at,e.id LIMIT 100 OFFSET p_page*100)s),'[]'),
   'messageCount',(SELECT count(*) FROM public.messenger_events e WHERE e.psid=v_candidate.psid AND e.page_id=v_candidate.page_id),
   'matches',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM (
    SELECT l.id,l.patient_id,l.lead_name,l.phone,l.source,p.hn,p.full_name,mis_internal.marketing_review_lead_version(l.id) version
    FROM public.crm_leads l LEFT JOIN public.patients p ON p.id=l.patient_id
    WHERE public.normalize_bd_phone(coalesce(nullif(l.phone_normalized,''),l.phone))=v_candidate.phone_e164
     OR l.id=v_review.selected_crm_lead_id ORDER BY l.id LIMIT 25)s),'[]'),
   'touches',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT t.id,t.touched_at,t.touch_type,t.ad_id,t.campaign_name,t.source_event_id
    FROM public.messenger_attribution_touches t WHERE t.psid=v_candidate.psid AND t.page_id=v_candidate.page_id ORDER BY t.touched_at LIMIT 50)s),'[]')) INTO v_result;
 ELSE
  SELECT * INTO v_patient FROM public.patients WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient not found' USING ERRCODE='P0002'; END IF;
  SELECT jsonb_build_object('patient',jsonb_build_object('id',v_patient.id,'hn',v_patient.hn,'full_name',v_patient.full_name,'phone',v_patient.phone_e164),
   'revenue',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM mis_internal.marketing_review_revenue_snapshot q WHERE q.patient_id=p_id),'[]'),
   'evidence',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.event_date,e.priority DESC,e.evidence_id) FROM mis_internal.marketing_source_evidence_v2 e WHERE e.patient_id=p_id),'[]'),
   'originalEvidence',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.event_date,e.priority DESC,e.evidence_id) FROM mis_internal.marketing_source_evidence_before_review e WHERE e.patient_id=p_id),'[]'),
   'sourceCorrection',(SELECT to_jsonb(c) FROM mis_internal.marketing_review_current_sources c WHERE c.patient_id=p_id),
   'invoices',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT i.id,i.invoice_no,i.invoice_date,i.net_bill,i.reconciliation_status FROM public.invoices i WHERE i.patient_id=p_id ORDER BY i.invoice_date,i.id LIMIT 100 OFFSET p_page*100)s),'[]'),
   'invoiceCount',(SELECT count(*) FROM public.invoices WHERE patient_id=p_id)) INTO v_result;
 END IF;
 IF p_id IS NOT NULL THEN
  v_result:=v_result||jsonb_build_object('version',mis_internal.marketing_review_case_version(p_kind,p_id),
   'history',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT a.request_id,a.actor_id,a.action,a.reason,a.evidence,a.after_data,a.requested_revision,a.created_at,
     coalesce((v_pipeline->>'current')::boolean,false) AND (v_pipeline->>'publishedRevision')::bigint>=a.requested_revision reconciled
     FROM mis_internal.marketing_review_actions a WHERE a.case_kind=p_kind AND a.case_id=p_id ORDER BY a.created_at DESC LIMIT 25)s),'[]'));
 END IF;
 RETURN v_result||jsonb_build_object('pipeline',v_pipeline);
END $$;

CREATE FUNCTION mis_internal.marketing_review_resolve(p_actor_id uuid,p_request_id uuid,p_kind text,p_id bigint,p_version text,p_payload jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_action text:=p_payload->>'action'; v_reason text:=btrim(p_payload->>'reason'); v_reference text:=btrim(p_payload->>'evidenceReference');
 v_prior mis_internal.marketing_review_actions%rowtype; v_review public.meta_call_center_reconciliation%rowtype;
 v_candidate public.meta_message_phone_candidates%rowtype; v_lead public.crm_leads%rowtype; v_patient public.patients%rowtype;
 v_before jsonb; v_after jsonb; v_evidence jsonb; v_revision bigint; v_hash text; v_lead_id bigint; v_source text; v_date date;
 v_exclusions jsonb; v_ref jsonb; v_status text; v_contact_id bigint; v_link bigint; v_old_link bigint;
BEGIN
 PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);
 IF coalesce(p_kind,'') NOT IN('meta','revenue') OR p_id IS NULL OR p_id<=0 OR p_request_id IS NULL
  OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>12000
  OR length(coalesce(v_reason,'')) NOT BETWEEN 20 AND 2000 THEN
  RAISE EXCEPTION 'A case, request ID and verification reason (20-2000 characters) are required' USING ERRCODE='22023'; END IF;
 v_hash:=md5(jsonb_build_array(p_kind,p_id,p_version,p_payload)::text);
 PERFORM pg_advisory_xact_lock(hashtextextended('marketing-admin-review',0));
 SELECT * INTO v_prior FROM mis_internal.marketing_review_actions WHERE request_id=p_request_id;
 IF FOUND THEN
  IF v_prior.actor_id<>p_actor_id OR v_prior.payload_hash<>v_hash THEN
   RAISE EXCEPTION 'Request ID already used for another correction' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('requestId',p_request_id,'sourceRevision',v_prior.requested_revision,'replayed',true,'pipeline',mis_internal.marketing_review_pipeline());
 END IF;
 IF p_version IS NULL OR p_version IS DISTINCT FROM mis_internal.marketing_review_case_version(p_kind,p_id) THEN
  RAISE EXCEPTION 'This case changed. Reload its evidence before saving' USING ERRCODE='40001'; END IF;
 v_before:=CASE WHEN p_kind='meta' THEN (SELECT to_jsonb(r) FROM public.meta_call_center_reconciliation r WHERE r.id=p_id)
  ELSE (SELECT coalesce(to_jsonb(c),'{}') FROM mis_internal.marketing_review_current_sources c WHERE c.patient_id=p_id) END;
 v_evidence:=jsonb_build_object('actorId',p_actor_id,'reference',v_reference,'attested',p_payload->'attested');
 IF p_kind='meta' THEN
  IF coalesce(v_action,'') NOT IN('confirm','duplicate','reject','no_match','needs_review','reopen') THEN RAISE EXCEPTION 'Invalid identity action' USING ERRCODE='22023'; END IF;
  SELECT * INTO STRICT v_review FROM public.meta_call_center_reconciliation WHERE id=p_id FOR UPDATE;
  SELECT * INTO STRICT v_candidate FROM public.meta_message_phone_candidates WHERE id=v_review.meta_candidate_id FOR UPDATE;
  SELECT m.id,m.converted_crm_lead_id INTO v_contact_id,v_link FROM public.messenger_contacts m
   WHERE m.psid=v_candidate.psid AND m.page_id=v_candidate.page_id FOR UPDATE;
  IF p_version IS DISTINCT FROM mis_internal.marketing_review_case_version(p_kind,p_id) THEN
   RAISE EXCEPTION 'This case changed. Reload its evidence before saving' USING ERRCODE='40001'; END IF;
  v_before:=v_before||jsonb_build_object('candidate',to_jsonb(v_candidate),'contact',
   (SELECT jsonb_build_object('id',id,'convertedLeadId',converted_crm_lead_id) FROM public.messenger_contacts WHERE id=v_contact_id),
   'eventLinks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'leadId',crm_lead_id) ORDER BY id),'[]') FROM public.messenger_events
    WHERE psid=v_candidate.psid AND page_id=v_candidate.page_id AND (id=ANY(v_candidate.source_event_ids) OR crm_lead_id=v_review.selected_crm_lead_id)));
  v_old_link:=v_review.selected_crm_lead_id;
  IF v_action IN('confirm','duplicate') THEN
   IF p_payload->'attested' IS DISTINCT FROM 'true'::jsonb OR length(coalesce(v_reference,'')) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Verified identity and supporting evidence reference are required' USING ERRCODE='22023'; END IF;
   v_lead_id:=(p_payload->>'leadId')::bigint;
   SELECT * INTO v_lead FROM public.crm_leads WHERE id=v_lead_id FOR UPDATE;
   IF NOT FOUND OR v_lead.patient_id IS NULL THEN RAISE EXCEPTION 'Choose an existing CRM lead linked to a canonical patient' USING ERRCODE='22023'; END IF;
   SELECT * INTO STRICT v_patient FROM public.patients WHERE id=v_lead.patient_id FOR SHARE;
   IF p_payload->>'leadVersion' IS DISTINCT FROM mis_internal.marketing_review_lead_version(v_lead_id) THEN
    RAISE EXCEPTION 'Selected CRM lead changed. Search and select it again' USING ERRCODE='40001'; END IF;
   IF nullif(public.normalize_hospital_identifier(v_patient.hn),'') IS NULL
    OR public.normalize_hospital_identifier(p_payload->>'verifiedHn') IS DISTINCT FROM public.normalize_hospital_identifier(v_patient.hn) THEN
    RAISE EXCEPTION 'Verify and enter the selected patient hospital number' USING ERRCODE='22023'; END IF;
   IF v_contact_id IS NULL THEN RAISE EXCEPTION 'Messenger contact missing; retain for review' USING ERRCODE='22023'; END IF;
   IF (v_link IS NOT NULL AND v_link<>v_lead_id AND v_link IS DISTINCT FROM v_old_link)
    OR EXISTS(SELECT 1 FROM public.meta_message_phone_candidates c JOIN public.meta_call_center_reconciliation r ON r.meta_candidate_id=c.id
      WHERE c.psid=v_candidate.psid AND c.page_id=v_candidate.page_id AND r.id<>p_id
       AND c.reconciliation_status='matched' AND r.review_status IN('confirmed_same_person','duplicate_resolved')
       AND r.selected_crm_lead_id IS DISTINCT FROM v_lead_id)
    OR EXISTS(SELECT 1 FROM public.messenger_events e WHERE e.psid=v_candidate.psid AND e.page_id=v_candidate.page_id
      AND e.crm_lead_id IS NOT NULL AND e.crm_lead_id<>v_lead_id AND e.crm_lead_id IS DISTINCT FROM v_old_link) THEN
    RAISE EXCEPTION 'Conversation has another verified CRM link; reopen that review first' USING ERRCODE='22023'; END IF;
   v_status:=CASE WHEN v_action='duplicate' THEN 'duplicate_resolved' ELSE 'confirmed_same_person' END;
   UPDATE public.meta_message_phone_candidates SET reconciliation_status='matched',reconciliation_notes=v_reason,
    reconciled_at=now(),reconciled_by=p_actor_id::text WHERE id=v_candidate.id;
   UPDATE public.meta_call_center_reconciliation SET review_status=v_status,selected_crm_lead_id=v_lead_id,
    review_notes=v_reason,reviewed_by=p_actor_id::text,reviewed_at=now() WHERE id=p_id;
   UPDATE public.messenger_contacts SET converted_crm_lead_id=v_lead_id,updated_at=now() WHERE id=v_contact_id;
   -- Link the reviewed candidate's events, not unrelated messages in the conversation.
   UPDATE public.messenger_events SET crm_lead_id=v_lead_id WHERE id=ANY(v_candidate.source_event_ids)
    AND psid=v_candidate.psid AND page_id=v_candidate.page_id;
   v_evidence:=v_evidence||jsonb_build_object('patientId',v_patient.id,'hospitalNumber',v_patient.hn,'leadId',v_lead_id,
    'sourceEventIds',v_candidate.source_event_ids,'verificationMethod','administrator_verified_identity');
  ELSE
   v_status:=CASE v_action WHEN 'reject' THEN 'not_same_person' WHEN 'no_match' THEN 'no_call_center_match' ELSE 'needs_review' END;
   UPDATE public.meta_call_center_reconciliation SET review_status=v_status,selected_crm_lead_id=NULL,
    review_notes=v_reason,reviewed_by=p_actor_id::text,reviewed_at=now() WHERE id=p_id;
   UPDATE public.meta_message_phone_candidates SET reconciliation_status=CASE WHEN v_action='reject' THEN 'rejected' ELSE 'reviewing' END,
    reconciliation_notes=v_reason,reconciled_at=now(),reconciled_by=p_actor_id::text WHERE id=v_candidate.id;
   IF v_old_link IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.meta_message_phone_candidates c JOIN public.meta_call_center_reconciliation r ON r.meta_candidate_id=c.id
     WHERE c.psid=v_candidate.psid AND c.page_id=v_candidate.page_id AND c.reconciliation_status='matched'
      AND r.review_status IN('confirmed_same_person','duplicate_resolved') AND r.selected_crm_lead_id=v_old_link) THEN
    UPDATE public.messenger_contacts SET converted_crm_lead_id=NULL,updated_at=now() WHERE id=v_contact_id AND converted_crm_lead_id=v_old_link;
    UPDATE public.messenger_events SET crm_lead_id=NULL WHERE psid=v_candidate.psid AND page_id=v_candidate.page_id AND crm_lead_id=v_old_link;
   END IF;
  END IF;
  v_after:=(SELECT to_jsonb(r) FROM public.meta_call_center_reconciliation r WHERE id=p_id);
  -- Capture the linked rows too; the source records themselves are retained.
  v_before:=v_before||jsonb_build_object('candidateStatus',v_candidate.reconciliation_status,'convertedLeadId',v_link);
  v_after:=v_after||jsonb_build_object('candidateStatus',(SELECT reconciliation_status FROM public.meta_message_phone_candidates WHERE id=v_candidate.id),
   'convertedLeadId',(SELECT converted_crm_lead_id FROM public.messenger_contacts WHERE id=v_contact_id),
   'eventLinks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'leadId',crm_lead_id) ORDER BY id),'[]') FROM public.messenger_events
    WHERE psid=v_candidate.psid AND page_id=v_candidate.page_id AND (id=ANY(v_candidate.source_event_ids) OR crm_lead_id=v_old_link)));
 ELSE
  IF coalesce(v_action,'') NOT IN('verify_source','retract_source','needs_review') THEN RAISE EXCEPTION 'Invalid source action' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_patient FROM public.patients WHERE id=p_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient not found' USING ERRCODE='P0002'; END IF;
  IF p_version IS DISTINCT FROM mis_internal.marketing_review_case_version(p_kind,p_id) THEN
   RAISE EXCEPTION 'This case changed. Reload its evidence before saving' USING ERRCODE='40001'; END IF;
  IF v_action='verify_source' THEN
   v_source:=p_payload->>'source'; v_date:=(p_payload->>'eventDate')::date;
   v_exclusions:=coalesce(p_payload->'excludedEvidence','[]'::jsonb);
   IF p_payload->'attested' IS DISTINCT FROM 'true'::jsonb OR length(coalesce(v_reference,'')) NOT BETWEEN 10 AND 1000
    OR v_source IS NULL OR v_source NOT IN('facebook','google','referral','doctor recommendation','organic_direct')
    OR v_date IS NULL OR v_date<date '2000-01-01' OR v_date>(now() AT TIME ZONE 'Asia/Dhaka')::date
    OR jsonb_typeof(v_exclusions)<>'array' OR jsonb_array_length(v_exclusions)>20 THEN
    RAISE EXCEPTION 'Verify the original acquisition source, date and supporting evidence' USING ERRCODE='22023'; END IF;
   IF nullif(public.normalize_hospital_identifier(v_patient.hn),'') IS NULL
    OR public.normalize_hospital_identifier(p_payload->>'verifiedHn') IS DISTINCT FROM public.normalize_hospital_identifier(v_patient.hn) THEN
    RAISE EXCEPTION 'Verify and enter this patient hospital number' USING ERRCODE='22023'; END IF;
   FOR v_ref IN SELECT * FROM jsonb_array_elements(v_exclusions) LOOP
    IF NOT EXISTS(SELECT 1 FROM mis_internal.marketing_source_evidence_before_review e WHERE e.patient_id=p_id
      AND e.evidence_table=v_ref->>'table' AND e.evidence_id=v_ref->>'id') THEN
     RAISE EXCEPTION 'A replaced evidence record does not belong to this patient' USING ERRCODE='22023'; END IF;
   END LOOP;
   INSERT INTO mis_internal.marketing_review_source_versions(patient_id,request_id,active,source,event_date,evidence_reference,excluded_evidence,actor_id)
    VALUES(p_id,p_request_id,true,v_source,v_date,v_reference,v_exclusions,p_actor_id);
   v_evidence:=v_evidence||jsonb_build_object('verificationMethod','administrator_verified_original_evidence','excludedEvidence',v_exclusions);
  ELSIF v_action='retract_source' THEN
   IF NOT EXISTS(SELECT 1 FROM mis_internal.marketing_review_current_sources WHERE patient_id=p_id AND active) THEN
    RAISE EXCEPTION 'No active source correction to retract' USING ERRCODE='22023'; END IF;
   INSERT INTO mis_internal.marketing_review_source_versions(patient_id,request_id,active,evidence_reference,actor_id)
    VALUES(p_id,p_request_id,false,coalesce(v_reference,v_reason),p_actor_id);
  END IF;
  v_after:=coalesce((SELECT to_jsonb(c) FROM mis_internal.marketing_review_current_sources c WHERE c.patient_id=p_id),'{}');
 END IF;
 -- Durable invalidation is committed with the decision; the HTTP worker kick is optional.
 UPDATE mis_internal.marketing_reconciliation_state SET revision=revision+1 WHERE singleton RETURNING revision INTO v_revision;
 INSERT INTO mis_internal.marketing_review_actions(request_id,actor_id,case_kind,case_id,action,payload_hash,reason,before_data,after_data,evidence,requested_revision)
 VALUES(p_request_id,p_actor_id,p_kind,p_id,v_action,v_hash,v_reason,coalesce(v_before,'{}'),v_after,v_evidence,v_revision);
 RETURN jsonb_build_object('requestId',p_request_id,'sourceRevision',v_revision,'replayed',false,'pipeline',mis_internal.marketing_review_pipeline());
END $$;

CREATE FUNCTION public.marketing_review_read(p_actor_id uuid,p_kind text,p_id bigint DEFAULT NULL,
 p_page integer DEFAULT 0,p_filter text DEFAULT '',p_search text DEFAULT '') RETURNS jsonb
 LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT mis_internal.marketing_review_read(p_actor_id,p_kind,p_id,p_page,p_filter,p_search)
$$;
CREATE FUNCTION public.marketing_review_resolve(p_actor_id uuid,p_request_id uuid,p_kind text,p_id bigint,p_version text,p_payload jsonb) RETURNS jsonb
 LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT mis_internal.marketing_review_resolve(p_actor_id,p_request_id,p_kind,p_id,p_version,p_payload)
$$;
REVOKE ALL ON FUNCTION mis_internal.refresh_marketing_review_snapshot(),mis_internal.marketing_review_publication_snapshot(),
 mis_internal.marketing_review_pipeline(),mis_internal.marketing_review_case_version(text,bigint),mis_internal.marketing_review_lead_version(bigint)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION mis_internal.marketing_review_read(uuid,text,bigint,integer,text,text),
 mis_internal.marketing_review_resolve(uuid,uuid,text,bigint,text,jsonb),
 public.marketing_review_read(uuid,text,bigint,integer,text,text),public.marketing_review_resolve(uuid,uuid,text,bigint,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mis_internal.marketing_review_read(uuid,text,bigint,integer,text,text),
 mis_internal.marketing_review_resolve(uuid,uuid,text,bigint,text,jsonb),
 public.marketing_review_read(uuid,text,bigint,integer,text,text),public.marketing_review_resolve(uuid,uuid,text,bigint,text,jsonb) TO service_role;

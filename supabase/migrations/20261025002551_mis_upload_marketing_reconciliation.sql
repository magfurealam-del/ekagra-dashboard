-- Recompute marketing decisions from original evidence. Import timestamps and
-- previously authenticated summaries must not authenticate a different source.
CREATE TABLE mis_internal.marketing_reconciliation_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 revision bigint NOT NULL DEFAULT 0
);
INSERT INTO mis_internal.marketing_reconciliation_state(singleton) VALUES(true);
CREATE TABLE mis_internal.marketing_reconciliation_runs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 target_batch_id bigint NOT NULL REFERENCES mis_internal.mis_gateway_batches(id),
 source_revision bigint NOT NULL,
 status text NOT NULL CHECK(status IN('running','completed','superseded')),
 last_patient_id integer NOT NULL DEFAULT 0,
 patients_processed integer NOT NULL DEFAULT 0,
 started_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 metrics jsonb NOT NULL DEFAULT '{}'
);
ALTER TABLE mis_internal.marketing_reconciliation_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.marketing_reconciliation_state FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.marketing_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.marketing_reconciliation_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON mis_internal.marketing_reconciliation_state,mis_internal.marketing_reconciliation_runs FROM PUBLIC,anon,authenticated;

CREATE FUNCTION mis_internal.mark_marketing_evidence_dirty() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE mis_internal.marketing_reconciliation_state SET revision=revision+1 WHERE singleton;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION mis_internal.mark_marketing_evidence_dirty() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['crm_leads','lead_attribution','call_center_logs','referral_patient_report',
  'messenger_contacts','messenger_attribution_touches','meta_message_phone_candidates',
  'meta_call_center_reconciliation','patients','crm_appointments'] LOOP
  EXECUTE format('CREATE TRIGGER mis_marketing_evidence_dirty AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION mis_internal.mark_marketing_evidence_dirty()',t);
 END LOOP;
END $$;

CREATE VIEW mis_internal.marketing_source_evidence_v2 WITH(security_invoker=true) AS
WITH phone_owner AS (
 SELECT phone_e164,min(id) patient_id FROM public.patients
 WHERE nullif(btrim(phone_e164),'') IS NOT NULL GROUP BY phone_e164 HAVING count(*)=1
), hn_owner AS (
 SELECT public.normalize_hospital_identifier(hn) hn,min(id) patient_id FROM public.patients
 WHERE nullif(btrim(hn),'') IS NOT NULL GROUP BY public.normalize_hospital_identifier(hn) HAVING count(*)=1
), calls AS (
 SELECT c.*,coalesce(c.matched_patient_id,c.patient_id) resolved_patient_id,
  (c.patient_id IS NOT NULL AND c.matched_patient_id IS NOT NULL AND c.patient_id<>c.matched_patient_id) identity_conflict,
  (h.patient_id=coalesce(c.matched_patient_id,c.patient_id) OR ph.patient_id=coalesce(c.matched_patient_id,c.patient_id)) identity_verified
 FROM public.call_center_logs c
 LEFT JOIN hn_owner h ON h.hn=public.normalize_hospital_identifier(c.patient_id_raw)
 LEFT JOIN phone_owner ph ON ph.phone_e164=c.mobile_e164
), evidence AS (
 SELECT l.patient_id,public.normalize_marketing_source(l.source) source,
  CASE WHEN l.source_system='migrated_call_center_logs' THEN c.log_date
       ELSE (l.created_at AT TIME ZONE 'Asia/Dhaka')::date END event_date,
  'crm_leads'::text evidence_table,l.id::text evidence_id,
  CASE WHEN l.source_system='migrated_call_center_logs' THEN 'original_call_log_date'
       WHEN l.source_system='google_sheet_backfill' THEN 'unverified_backfill_date'
       ELSE 'original_crm_event_date' END date_basis,
  (l.patient_id IS NOT NULL AND (l.source_system<>'migrated_call_center_logs' OR
   (c.resolved_patient_id=l.patient_id AND c.identity_verified AND NOT c.identity_conflict))
   AND l.source_system<>'google_sheet_backfill') authenticated,
  (l.source_system='migrated_call_center_logs' AND (c.id IS NULL OR c.resolved_patient_id IS DISTINCT FROM l.patient_id OR c.identity_conflict)) identity_conflict,
  (lower(coalesce(l.call_direction,'')) IN('outgoing','outbound') OR lower(coalesce(c.call_category,'')) LIKE '%outgoing%') outbound,
  80 priority,0.85::numeric confidence,l.campaign_name,NULL::text campaign_id,
  CASE WHEN l.meta_ad_id_conflict IS NOT TRUE THEN l.validated_meta_ad_id END ad_id,
  'direct_crm_patient_link'::text authentication_method
 FROM public.crm_leads l LEFT JOIN calls c ON l.source_system='migrated_call_center_logs' AND l.external_lead_id=c.id::text
 UNION ALL
 SELECT c.resolved_patient_id,public.normalize_marketing_source(coalesce(c.lead_source,c.call_source)),c.log_date,
  'call_center_logs',c.id::text,'original_call_log_date',
  coalesce(c.identity_verified,false) AND NOT c.identity_conflict,c.identity_conflict,
  lower(coalesce(c.call_category,'')) LIKE '%outgoing%',70,coalesce(c.matched_confidence,0),c.ad_campaign,NULL,NULL,'unique_hn_or_phone'
 FROM calls c
 UNION ALL
 SELECT a.patient_id,public.normalize_marketing_source(a.source_category),
  coalesce(c.log_date,CASE WHEN l.source_system='migrated_call_center_logs' THEN original_call.log_date ELSE a.first_touch_date END),
  'lead_attribution',a.id::text,
  CASE WHEN c.id IS NOT NULL OR original_call.id IS NOT NULL THEN 'original_call_log_date' ELSE 'attribution_event_date' END,
  (a.patient_id IS NOT NULL AND (coalesce(a.attribution_confidence,0)>=0.85 OR a.attribution_level IN('manual','validated'))
   AND (c.id IS NULL OR (c.resolved_patient_id=a.patient_id AND c.identity_verified AND NOT c.identity_conflict))
   AND (a.lead_id IS NULL OR l.patient_id=a.patient_id)
   AND (l.source_system IS DISTINCT FROM 'google_sheet_backfill' OR a.attribution_level IN('manual','validated'))
   AND (l.source_system IS DISTINCT FROM 'migrated_call_center_logs' OR
     (original_call.resolved_patient_id=a.patient_id AND original_call.identity_verified AND NOT original_call.identity_conflict))),
  (coalesce(c.identity_conflict,false) OR (c.id IS NOT NULL AND c.resolved_patient_id IS DISTINCT FROM a.patient_id)
   OR (a.lead_id IS NOT NULL AND l.patient_id IS DISTINCT FROM a.patient_id)),
  (lower(coalesce(l.call_direction,'')) IN('outgoing','outbound') OR lower(coalesce(c.call_category,original_call.call_category,'')) LIKE '%outgoing%'),
  CASE WHEN a.attribution_level IN('manual','validated') THEN 110 ELSE 85 END,
  coalesce(a.attribution_confidence,0),a.meta_campaign_name,
  CASE WHEN a.attribution_level IN('manual','validated','exact_ad','meta_ad','meta_campaign','campaign') AND coalesce(a.attribution_confidence,0)>=0.85 THEN a.meta_campaign_id END,
  CASE WHEN a.attribution_level IN('manual','validated','exact_ad','meta_ad') AND coalesce(a.attribution_confidence,0)>=0.85 THEN a.meta_ad_id END,
  'original_linked_attribution_record'
 FROM public.lead_attribution a LEFT JOIN calls c ON c.id=a.call_center_log_id
 LEFT JOIN public.crm_leads l ON l.id=a.lead_id
 LEFT JOIN calls original_call ON l.source_system='migrated_call_center_logs' AND l.external_lead_id=original_call.id::text
 UNION ALL
 SELECT h.patient_id,
  CASE WHEN r.mpo_name ~* '(facebook|fb2002)' THEN 'facebook'
       WHEN r.mpo_name ~* '(^|[^a-z])(dr[.]?|doctor|prof[.]?)([^a-z]|$)' THEN 'doctor recommendation'
       WHEN r.mpo_name ~* '(referr|word of mouth)' THEN 'referral' ELSE 'unknown' END,
  (r.reg_date AT TIME ZONE 'Asia/Dhaka')::date,'referral_patient_report',r.id::text,'hospital_registration_date',
  h.patient_id IS NOT NULL,false,false,100,1.0,NULL,NULL,NULL,'hospital_referral_report_hn'
 FROM public.referral_patient_report r JOIN hn_owner h ON h.hn=public.normalize_hospital_identifier(r.hospital_number)
 UNION ALL
 SELECT l.patient_id,'facebook',(t.touched_at AT TIME ZONE 'Asia/Dhaka')::date,
  'messenger_attribution_touches',t.id::text,'original_platform_event',true,false,false,105,1.0,
  t.campaign_name,t.campaign_id,t.ad_id,'reviewed_meta_crm_identity'
 FROM public.messenger_attribution_touches t
 JOIN public.messenger_contacts m ON m.psid=t.psid AND m.page_id=t.page_id
 JOIN public.crm_leads l ON l.id=m.converted_crm_lead_id
 WHERE l.patient_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.meta_message_phone_candidates c JOIN public.meta_call_center_reconciliation r ON r.meta_candidate_id=c.id
  WHERE c.psid=t.psid AND c.page_id=t.page_id AND c.reconciliation_status='matched'
   AND r.selected_crm_lead_id=l.id AND r.review_status IN('confirmed_same_person','duplicate_resolved')
   AND r.reviewed_at IS NOT NULL)
)
SELECT patient_id,source,event_date,evidence_table,evidence_id,date_basis,
 coalesce(authenticated,false) AND NOT coalesce(identity_conflict,false) authenticated,
 coalesce(identity_conflict,false) identity_conflict,coalesce(outbound,false) outbound,
 priority,confidence,campaign_name,campaign_id,ad_id,authentication_method
FROM evidence WHERE patient_id IS NOT NULL;
REVOKE ALL ON mis_internal.marketing_source_evidence_v2 FROM PUBLIC,anon,authenticated;

ALTER TABLE public.patient_marketing_attribution
 ADD COLUMN attribution_status text NOT NULL DEFAULT 'not_reconciled',
 ADD COLUMN first_touch_date_basis text,
 ADD COLUMN source_conflict boolean NOT NULL DEFAULT false,
 ADD COLUMN same_day_ordering_uncertain boolean NOT NULL DEFAULT false,
 ADD COLUMN acquisition_ad_id text,
 ADD COLUMN pipeline_rule_version text;

CREATE FUNCTION mis_internal.rebuild_marketing_patients(p_patient_ids integer[]) RETURNS integer
 LANGUAGE plpgsql SET search_path='' AS $$
DECLARE n integer;
BEGIN
 WITH e AS MATERIALIZED (
  SELECT * FROM mis_internal.marketing_source_evidence_v2 WHERE patient_id=ANY(p_patient_ids)
 ), conversion AS (
  SELECT i.patient_id,min(i.invoice_date) first_clinical FROM public.invoices i
  WHERE i.patient_id=ANY(p_patient_ids) AND i.reconciliation_status='matched'
   AND i.invoice_type IS DISTINCT FROM 'refund' AND i.invoice_status NOT IN('void','cancelled')
   AND EXISTS(SELECT 1 FROM public.invoice_line_items l WHERE l.invoice_id=i.id AND (
    lower(btrim(coalesce(l.category_name,''))) IN('opd services','daycare consultation','ipd consultation','therapeutics','ot/surgery','ot room charges','ipd services','emergency service')
    OR lower(btrim(coalesce(l.item_type,'')))='procedure'
    OR lower(coalesce(l.particulars,'')) ~ '(consultation|dressing charge|hbot|vacuarc|wound screening|outpatient procedure|therapy session)'))
  GROUP BY i.patient_id
 ), scored AS (
  SELECT e.*,c.first_clinical,
   (e.authenticated AND NOT e.outbound AND e.event_date IS NOT NULL AND nullif(btrim(e.source),'') IS NOT NULL
    AND e.source NOT IN('unknown','other','n/a','na') AND e.event_date<=c.first_clinical) eligible
  FROM e LEFT JOIN conversion c USING(patient_id)
 ), ranked AS (
  SELECT s.*,row_number() OVER(PARTITION BY patient_id ORDER BY coalesce(eligible,false) DESC,
   event_date NULLS LAST,priority DESC,confidence DESC,evidence_table,evidence_id) rn
  FROM scored s
 ), chosen AS (SELECT * FROM ranked WHERE rn=1), latest AS (
  SELECT *,row_number() OVER(PARTITION BY patient_id ORDER BY event_date DESC NULLS LAST,priority DESC,evidence_table,evidence_id) latest_rn FROM e
 ), stats AS (
  SELECT patient_id,count(*) cnt FROM e GROUP BY patient_id
 ), decisions AS (
  SELECT u.patient_id,c.source,c.event_date,c.evidence_table,c.evidence_id,c.date_basis,
   c.authenticated,c.identity_conflict,c.outbound,c.priority,c.confidence,c.campaign_name,c.campaign_id,c.ad_id,c.authentication_method,c.eligible,
   co.first_clinical conversion_date,s.cnt,lt.source latest_source,lt.event_date latest_date,
   coalesce((SELECT count(distinct r.source)>1 FROM ranked r WHERE r.patient_id=u.patient_id
    AND r.eligible AND r.event_date=c.event_date AND r.priority=c.priority AND r.confidence=c.confidence),false) conflict
  FROM unnest(p_patient_ids) u(patient_id)
  LEFT JOIN chosen c USING(patient_id) LEFT JOIN conversion co USING(patient_id)
  LEFT JOIN stats s USING(patient_id) LEFT JOIN latest lt ON lt.patient_id=u.patient_id AND lt.latest_rn=1
 )
 INSERT INTO public.patient_marketing_attribution AS old(
  patient_id,first_touch_source,first_touch_date,first_touch_evidence_table,first_touch_evidence_id,
  latest_touch_source,latest_touch_date,conversion_source,conversion_date,validated_source,source_priority,
  campaign_id,campaign_name,confidence,is_authenticated,authentication_method,evidence_count,rebuilt_at,updated_at,
  attribution_status,first_touch_date_basis,source_conflict,same_day_ordering_uncertain,acquisition_ad_id,pipeline_rule_version)
 SELECT d.patient_id,d.source,d.event_date,d.evidence_table,d.evidence_id,d.latest_source,d.latest_date,
  CASE WHEN d.eligible AND NOT d.conflict THEN d.source END,d.conversion_date,
  CASE WHEN d.eligible AND NOT d.conflict THEN d.source END,coalesce(d.priority,0),
  CASE WHEN d.eligible AND NOT d.conflict THEN d.campaign_id END,
  CASE WHEN d.eligible AND NOT d.conflict THEN d.campaign_name END,
  d.confidence,coalesce(d.authenticated,false) AND NOT d.conflict,d.authentication_method,coalesce(d.cnt,0),now(),now(),
  CASE WHEN coalesce(d.cnt,0)=0 THEN 'missing_source' WHEN d.conflict THEN 'conflicting_source'
   WHEN d.identity_conflict THEN 'identity_conflict' WHEN d.outbound THEN 'outbound_only'
   WHEN d.event_date IS NULL OR d.source IS NULL OR d.source IN('unknown','other','n/a','na') THEN 'unknown_source'
   WHEN d.authenticated IS DISTINCT FROM true THEN 'unauthenticated_source'
   WHEN d.conversion_date IS NULL THEN 'no_clinical_conversion'
   WHEN d.event_date>d.conversion_date THEN 'late_source' ELSE 'eligible_source' END,
  d.date_basis,d.conflict,coalesce(d.event_date=d.conversion_date,false),
  CASE WHEN d.eligible AND NOT d.conflict THEN d.ad_id END,'source_evidence_v2'
 FROM decisions d
 ON CONFLICT(patient_id) DO UPDATE SET
  first_touch_source=excluded.first_touch_source,first_touch_date=excluded.first_touch_date,
  first_touch_evidence_table=excluded.first_touch_evidence_table,first_touch_evidence_id=excluded.first_touch_evidence_id,
  latest_touch_source=excluded.latest_touch_source,latest_touch_date=excluded.latest_touch_date,
  conversion_source=excluded.conversion_source,conversion_date=excluded.conversion_date,
  validated_source=excluded.validated_source,source_priority=excluded.source_priority,
  campaign_id=excluded.campaign_id,campaign_name=excluded.campaign_name,confidence=excluded.confidence,
  is_authenticated=excluded.is_authenticated,authentication_method=excluded.authentication_method,
  evidence_count=excluded.evidence_count,rebuilt_at=excluded.rebuilt_at,updated_at=excluded.updated_at,
  attribution_status=excluded.attribution_status,first_touch_date_basis=excluded.first_touch_date_basis,
  source_conflict=excluded.source_conflict,same_day_ordering_uncertain=excluded.same_day_ordering_uncertain,
  acquisition_ad_id=excluded.acquisition_ad_id,pipeline_rule_version=excluded.pipeline_rule_version;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;

CREATE FUNCTION mis_internal.prepare_marketing_source_links() RETURNS jsonb
 LANGUAGE plpgsql SET search_path='' AS $prepare$
DECLARE v_calls integer; v_leads integer; v_original integer; v_attribution integer:=0;
BEGIN
 WITH owners AS (
  SELECT public.normalize_hospital_identifier(hn) hn,min(id) patient_id FROM public.patients
  WHERE nullif(btrim(hn),'') IS NOT NULL GROUP BY public.normalize_hospital_identifier(hn) HAVING count(*)=1
 )
 UPDATE public.call_center_logs c SET patient_id=o.patient_id,matched_patient_id=o.patient_id,
  matched_method='mis_hn_exact',matched_confidence=1,last_matched_at=now()
 FROM owners o WHERE c.patient_id IS NULL AND c.matched_patient_id IS NULL
  AND public.normalize_hospital_identifier(c.patient_id_raw)=o.hn;
 GET DIAGNOSTICS v_calls=ROW_COUNT;
 UPDATE public.crm_leads l SET patient_id=c.patient_id,updated_at=now(),updated_by='mis_marketing_pipeline'
 FROM public.call_center_logs c
 WHERE l.patient_id IS NULL AND l.source_system='migrated_call_center_logs'
  AND l.external_lead_id=c.id::text AND c.patient_id=c.matched_patient_id
  AND c.matched_method='mis_hn_exact';
 GET DIAGNOSTICS v_original=ROW_COUNT;
 WITH phones AS (
  SELECT public.normalize_bd_phone(coalesce(nullif(phone_e164,''),phone)) phone,min(id) patient_id
  FROM public.patients
  WHERE public.normalize_bd_phone(coalesce(nullif(phone_e164,''),phone)) IS NOT NULL
  GROUP BY public.normalize_bd_phone(coalesce(nullif(phone_e164,''),phone)) HAVING count(*)=1
 )
 UPDATE public.crm_leads l SET patient_id=p.id,updated_at=now(),updated_by='mis_marketing_pipeline'
 FROM phones ph JOIN public.patients p ON p.id=ph.patient_id
 WHERE l.patient_id IS NULL AND l.source_system IS DISTINCT FROM 'migrated_call_center_logs'
  AND public.normalize_bd_phone(coalesce(nullif(l.phone_normalized,''),l.phone))=ph.phone
  AND nullif(lower(btrim(l.lead_name)),'')=nullif(lower(btrim(p.full_name)),'');
 GET DIAGNOSTICS v_leads=ROW_COUNT;
 IF EXISTS(SELECT 1 FROM public.crm_leads l WHERE l.patient_id IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM public.lead_attribution a WHERE a.lead_id=l.id)) THEN
  INSERT INTO public.lead_attribution(lead_id,patient_id,phone_e164,source_category,attribution_level,attribution_confidence,
   meta_campaign_name,campaign_bucket,self_reported_source,first_touch_date,last_touch_date)
  SELECT l.id,l.patient_id,public.normalize_bd_phone(coalesce(nullif(l.phone_normalized,''),l.phone)),
   coalesce(public.normalize_marketing_source(l.source),'unknown'),
   CASE WHEN nullif(btrim(l.source),'') IS NULL THEN 'unknown' ELSE 'self_reported' END,
   CASE WHEN l.source_system='google_sheet_backfill' THEN 0 ELSE 0.85 END,l.campaign_name,
   CASE WHEN lower(coalesce(l.lead_bucket,'')) IN('wound','screening','awareness','retargeting') THEN lower(l.lead_bucket) ELSE 'unknown' END,
   l.source,CASE WHEN l.source_system='migrated_call_center_logs' THEN c.log_date
    WHEN l.source_system='google_sheet_backfill' THEN NULL ELSE (l.created_at AT TIME ZONE 'Asia/Dhaka')::date END,
   CASE WHEN l.source_system='migrated_call_center_logs' THEN c.log_date
    WHEN l.source_system='google_sheet_backfill' THEN NULL ELSE (l.created_at AT TIME ZONE 'Asia/Dhaka')::date END
  FROM public.crm_leads l LEFT JOIN public.call_center_logs c ON l.source_system='migrated_call_center_logs' AND l.external_lead_id=c.id::text
  WHERE l.patient_id IS NOT NULL AND (l.source_system IS DISTINCT FROM 'migrated_call_center_logs'
   OR (c.patient_id=l.patient_id AND (c.matched_patient_id IS NULL OR c.matched_patient_id=l.patient_id)))
   AND NOT EXISTS(SELECT 1 FROM public.lead_attribution a WHERE a.lead_id=l.id)
  ON CONFLICT(lead_id) DO NOTHING;
  GET DIAGNOSTICS v_attribution=ROW_COUNT;
 END IF;
 RETURN jsonb_build_object('calls_linked_by_hn',v_calls,'original_leads_linked',v_original,
  'leads_linked_by_unique_phone_and_exact_name',v_leads,'lead_attribution_created',v_attribution);
END $prepare$;
REVOKE ALL ON FUNCTION mis_internal.prepare_marketing_source_links() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION mis_internal.marketing_source_health() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('latestStoredSpendDate',(SELECT max(date) FROM public.marketing_daily_spend),
  'spendAccounts','[]'::jsonb,'metaIdentityReviewsOpen',(SELECT count(*) FROM public.meta_call_center_reconciliation WHERE review_status IN('unreviewed','needs_review')));
$$;
REVOKE ALL ON FUNCTION mis_internal.marketing_source_health() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION mis_internal.refresh_gateway_marketing_attribution(p_target bigint,p_limit integer DEFAULT 100) RETURNS jsonb
 LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_revision bigint; v_run mis_internal.marketing_reconciliation_runs%rowtype;
 v_ids integer[]; v_n integer; v_metrics jsonb;
BEGIN
 IF mis_internal.gateway_publication_blocked() THEN RETURN jsonb_build_object('status','deferred_gateway'); END IF;
 IF NOT mis_internal.is_overnight() THEN RETURN jsonb_build_object('status','outside_overnight_window'); END IF;
 SELECT revision INTO v_revision FROM mis_internal.marketing_reconciliation_state WHERE singleton;
 SELECT * INTO v_run FROM mis_internal.marketing_reconciliation_runs WHERE status='running' ORDER BY id DESC LIMIT 1 FOR UPDATE;
 IF FOUND AND (v_run.source_revision<>v_revision OR v_run.target_batch_id<>p_target) THEN
  UPDATE mis_internal.marketing_reconciliation_runs SET status='superseded',completed_at=now() WHERE id=v_run.id;
  v_run.id:=NULL;
 END IF;
 IF v_run.id IS NULL THEN
  PERFORM mis_internal.prepare_marketing_source_links();
  SELECT revision INTO v_revision FROM mis_internal.marketing_reconciliation_state WHERE singleton;
  INSERT INTO mis_internal.marketing_reconciliation_runs(target_batch_id,source_revision,status)
   VALUES(p_target,v_revision,'running') RETURNING * INTO v_run;
 END IF;
 SELECT array_agg(patient_id ORDER BY patient_id) INTO v_ids FROM (
  SELECT patient_id FROM (
   SELECT patient_id FROM public.patient_marketing_attribution
   UNION SELECT patient_id FROM public.invoices WHERE patient_id IS NOT NULL
   UNION SELECT patient_id FROM mis_internal.marketing_source_evidence_v2
  ) u WHERE patient_id>v_run.last_patient_id ORDER BY patient_id LIMIT greatest(1,least(coalesce(p_limit,100),250))
 ) q;
 IF v_ids IS NOT NULL THEN
  v_n:=mis_internal.rebuild_marketing_patients(v_ids);
  UPDATE mis_internal.marketing_reconciliation_runs SET last_patient_id=v_ids[array_length(v_ids,1)],
   patients_processed=patients_processed+v_n WHERE id=v_run.id;
  RETURN jsonb_build_object('status','step_completed','run_id',v_run.id,'patients',v_n);
 END IF;
 IF EXISTS(SELECT 1 FROM public.invoices i LEFT JOIN public.patient_marketing_attribution a ON a.patient_id=i.patient_id
  WHERE a.patient_id IS NULL OR a.pipeline_rule_version IS DISTINCT FROM 'source_evidence_v2') THEN
  RAISE EXCEPTION 'Marketing reconciliation did not cover every billed patient';
 END IF;
 SELECT jsonb_object_agg(attribution_status,n) INTO v_metrics FROM (
  SELECT attribution_status,count(*) n FROM public.patient_marketing_attribution GROUP BY attribution_status
 ) q;
 UPDATE mis_internal.marketing_reconciliation_runs SET status='completed',completed_at=now(),metrics=v_metrics WHERE id=v_run.id;
 RETURN jsonb_build_object('status','completed','run_id',v_run.id,'source_revision',v_revision,'patient_counts',v_metrics);
END $$;
REVOKE ALL ON FUNCTION mis_internal.refresh_gateway_marketing_attribution(bigint,integer) FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE mis_internal.mis_gateway_publication
 ADD COLUMN rules_version text NOT NULL DEFAULT 'legacy',
 ADD COLUMN marketing_revision bigint NOT NULL DEFAULT -1,
 ADD COLUMN marketing_run_id bigint REFERENCES mis_internal.marketing_reconciliation_runs(id);
ALTER TABLE mis_internal.mis_gateway_publication DROP CONSTRAINT mis_gateway_publication_stage_check;
ALTER TABLE mis_internal.mis_gateway_publication ADD CONSTRAINT mis_gateway_publication_stage_check
 CHECK(stage IN('finance','marketing','lifetime','contacts','ad_outcomes','snapshots','complete'));
ALTER TABLE mis_internal.shadow_patient_acquisitions DROP CONSTRAINT shadow_patient_acquisitions_attribution_class_check;
ALTER TABLE mis_internal.shadow_patient_acquisitions ADD CONSTRAINT shadow_patient_acquisitions_attribution_class_check
 CHECK(attribution_class IN('eligible_source','missing_source','late_source','unknown_source','unauthenticated_source',
  'conflicting_source','identity_conflict','outbound_only','no_clinical_conversion'));

CREATE OR REPLACE FUNCTION mis_internal.gateway_publication_blocked() RETURNS boolean
 LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM mis_internal.mis_gateway_jobs WHERE status IN('pending','failed'))
 OR (coalesce(current_setting('app.mis_gateway_publish',true),'')<>'on' AND EXISTS(
  SELECT 1 FROM mis_internal.mis_gateway_publication p CROSS JOIN mis_internal.marketing_reconciliation_state s
  WHERE p.published_batch_id<coalesce((SELECT max(id) FROM mis_internal.mis_gateway_batches),0)
   OR p.rules_version<>'marketing_pipeline_v2' OR p.marketing_revision<s.revision));
$$;

CREATE FUNCTION mis_internal.marketing_coverage_metrics() RETURNS jsonb
 LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(attribution_class,jsonb_build_object('invoices',n,'patients',patients,'net_bill',net_bill)),'{}')
 FROM (SELECT attribution_class,count(*) n,count(distinct patient_id) patients,sum(net_bill) net_bill
  FROM mis_internal.shadow_invoice_attribution GROUP BY attribution_class) q;
$$;
REVOKE ALL ON FUNCTION mis_internal.marketing_coverage_metrics() FROM PUBLIC,anon,authenticated,service_role;

-- Seal and create durable jobs in one request/transaction. Invalid invoice
-- headers remain sealed for review, with a durable intake event explaining why.
CREATE FUNCTION mis_internal.complete_mis_upload(p_actor_id uuid,p_attempt_id uuid,p_parse_id uuid,p_enqueue boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sealed jsonb; pipeline jsonb; pipeline_error text;
BEGIN
 sealed:=mis_internal.seal_mis_upload_parse(p_actor_id,p_attempt_id,p_parse_id);
 IF p_enqueue AND sealed->>'state'='validated' THEN
  BEGIN
   pipeline:=mis_internal.enqueue_mis_upload(p_actor_id,(sealed->>'uploadId')::uuid);
  EXCEPTION WHEN SQLSTATE '22023' THEN
   pipeline_error:='Invoice validation blocked ingestion. Review conflicting header fields or invoices exceeding 1,000 lines.';
   INSERT INTO mis_internal.mis_upload_attempt_events(attempt_id,event_type,details)
    VALUES(p_attempt_id,'rejected',jsonb_build_object('upload_id',sealed->>'uploadId','stage','enqueue','code','22023'));
  END;
 END IF;
 RETURN sealed||jsonb_build_object('pipeline',pipeline,'pipelineError',pipeline_error);
END $$;
REVOKE ALL ON FUNCTION mis_internal.complete_mis_upload(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mis_internal.complete_mis_upload(uuid,uuid,uuid,boolean) TO service_role;
CREATE FUNCTION public.complete_mis_upload(p_actor_id uuid,p_attempt_id uuid,p_parse_id uuid,p_enqueue boolean) RETURNS jsonb
 LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT mis_internal.complete_mis_upload(p_actor_id,p_attempt_id,p_parse_id,p_enqueue)
$$;
REVOKE ALL ON FUNCTION public.complete_mis_upload(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_mis_upload(uuid,uuid,uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION mis_internal.rebuild_marketing_patients(integer[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.rebuild_patient_marketing_attribution(p_patient_id integer) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_patient_id IS NOT NULL THEN PERFORM mis_internal.rebuild_marketing_patients(ARRAY[p_patient_id]); END IF;
END $$;

CREATE OR REPLACE VIEW public.vw_marketing_executive_summary WITH(security_invoker=true) AS
WITH mapping AS (
 SELECT meta_campaign_id,
  CASE WHEN count(distinct campaign_bucket)=1 THEN min(campaign_bucket) ELSE 'unknown' END campaign_bucket,
  bool_or(coalesce(exclude_from_benchmarks,false)) excluded
 FROM public.marketing_campaign_map GROUP BY meta_campaign_id
), spend AS (
 SELECT coalesce(m.campaign_bucket,'unknown') campaign_bucket,sum(s.spend_usd) spend_usd,sum(s.spend_bdt) spend_bdt,
  sum(s.conversations)::bigint meta_conversations
 FROM public.marketing_daily_spend s LEFT JOIN mapping m ON m.meta_campaign_id=s.meta_campaign_id
 WHERE coalesce(m.excluded,false)=false GROUP BY 1
), lead_source AS (
 SELECT l.id,coalesce(nullif(a.campaign_bucket,''),nullif(l.lead_bucket,''),'unknown') campaign_bucket,a.attribution_confidence
 FROM public.crm_leads l LEFT JOIN public.lead_attribution a ON a.lead_id=l.id
), leads AS (
 SELECT campaign_bucket,count(*) crm_leads,avg(attribution_confidence) attribution_confidence_avg FROM lead_source GROUP BY 1
), appointments AS (
 SELECT l.campaign_bucket,count(distinct a.id) appointments_booked,
  count(distinct a.id) FILTER(WHERE a.visit_verified AND a.visit_verified_by='mis_exact_patient_date_doctor') appointments_attended,
  count(distinct a.id) FILTER(WHERE a.appointment_status='No-show' AND a.visit_verified IS DISTINCT FROM true) no_shows
 FROM lead_source l JOIN public.crm_appointments a ON a.lead_id=l.id GROUP BY 1
), revenue AS (
 SELECT coalesce(m.campaign_bucket,'unknown') campaign_bucket,sum(i.net_bill) revenue_bdt
 FROM public.invoices i JOIN public.patient_marketing_attribution a ON a.patient_id=i.patient_id
 LEFT JOIN mapping m ON m.meta_campaign_id=a.campaign_id
 WHERE a.attribution_status='eligible_source' AND i.invoice_date>=a.first_touch_date
  AND i.reconciliation_status='matched' AND i.invoice_status NOT IN('void','cancelled')
 GROUP BY 1
), keys AS (
 SELECT campaign_bucket FROM spend UNION SELECT campaign_bucket FROM leads
 UNION SELECT campaign_bucket FROM appointments UNION SELECT campaign_bucket FROM revenue
)
SELECT k.campaign_bucket,
 (SELECT CASE WHEN count(distinct internal_type_code)=1 THEN min(internal_type_code) ELSE NULL END
  FROM public.marketing_campaign_map mm WHERE mm.campaign_bucket=k.campaign_bucket) internal_type_code,
 round(coalesce(s.spend_usd,0),2) spend_usd,coalesce(s.meta_conversations,0::bigint) meta_conversations,
 coalesce(l.crm_leads,0::bigint) crm_leads,coalesce(a.appointments_booked,0::bigint) appointments_booked,
 coalesce(a.appointments_attended,0::bigint) appointments_attended,coalesce(a.no_shows,0::bigint) no_shows,
 round(coalesce(r.revenue_bdt,0),0) revenue_bdt,
 round(s.spend_usd/nullif(l.crm_leads,0),2) cost_per_lead_usd,
 round(s.spend_usd/nullif(a.appointments_booked,0),2) cost_per_booked_usd,
 round(s.spend_usd/nullif(a.appointments_attended,0),2) cost_per_attended_usd,
 round(r.revenue_bdt/nullif(l.crm_leads,0),0) revenue_per_lead_bdt,
 round(a.appointments_booked::numeric/nullif(l.crm_leads,0),3) booking_rate,
 round(a.appointments_attended::numeric/nullif(a.appointments_booked,0),3) show_rate,
 round(coalesce(l.attribution_confidence_avg,0),2) attribution_confidence_avg,
 round(coalesce(s.spend_bdt,0),2) spend_bdt
FROM keys k LEFT JOIN spend s USING(campaign_bucket) LEFT JOIN leads l USING(campaign_bucket)
 LEFT JOIN appointments a USING(campaign_bucket) LEFT JOIN revenue r USING(campaign_bucket);


CREATE OR REPLACE VIEW public.vw_meta_phone_ad_outcome_source WITH(security_invoker=true) AS
 WITH candidate_latest AS (
         SELECT DISTINCT ON (c.phone_e164, c.meta_ad_id) c.id AS candidate_id,
            c.phone_e164,
            c.meta_ad_id,
            c.meta_ad_name,
            c.meta_adset_id,
            c.meta_adset_name,
            c.meta_campaign_id,
            c.meta_campaign_name,
            c.first_seen_at,
            c.last_seen_at,
            c.reconciliation_status
           FROM meta_message_phone_candidates c
          WHERE ((c.phone_e164 IS NOT NULL) AND (c.meta_ad_id IS NOT NULL))
          ORDER BY c.phone_e164, c.meta_ad_id, c.last_seen_at DESC NULLS LAST, c.id DESC
        ), lead_latest AS (
         SELECT DISTINCT ON (l.phone_normalized, l.meta_ad_id) l.id AS crm_lead_id,
            l.phone_normalized AS phone_e164,
            l.meta_ad_id
           FROM crm_leads l
          WHERE ((l.phone_normalized IS NOT NULL) AND (l.meta_ad_id IS NOT NULL))
            AND coalesce(l.meta_ad_id_conflict,false)=false
            AND (SELECT count(*) FROM public.crm_leads other_lead WHERE other_lead.phone_normalized=l.phone_normalized AND other_lead.meta_ad_id=l.meta_ad_id)=1
            AND EXISTS(SELECT 1 FROM public.patient_marketing_attribution verified WHERE verified.patient_id=l.patient_id AND verified.attribution_status='eligible_source' AND verified.acquisition_ad_id=l.meta_ad_id)
          ORDER BY l.phone_normalized, l.meta_ad_id,
                CASE
                    WHEN (l.meta_ad_id_source = 'validated_meta_message'::text) THEN 1
                    WHEN (l.meta_ad_id_source = 'crm_comment'::text) THEN 2
                    WHEN (l.meta_ad_id_source = 'existing_crm'::text) THEN 3
                    ELSE 4
                END, l.updated_at DESC NULLS LAST, l.id DESC
        ), phone_ad_pairs AS (
         SELECT candidate_latest.phone_e164,
            candidate_latest.meta_ad_id
           FROM candidate_latest
        UNION
         SELECT lead_latest.phone_e164,
            lead_latest.meta_ad_id
           FROM lead_latest
        ), unique_phone_lead AS (
         SELECT l.phone_normalized AS phone_e164,
            min(l.id) AS crm_lead_id
           FROM crm_leads l
          WHERE (l.phone_normalized IS NOT NULL)
          GROUP BY l.phone_normalized
         HAVING (count(*) = 1)
        ), ad_metadata AS (
         SELECT DISTINCT ON (a.ad_id) a.ad_id,
            a.ad_name,
            a.adset_id,
            a.adset_name,
            a.campaign_id,
            a.campaign_name
           FROM meta_active_ads a
          WHERE (a.ad_id IS NOT NULL)
          ORDER BY a.ad_id, a.is_current DESC, a.last_synced_at DESC NULLS LAST, a.checked_at DESC NULLS LAST, a.id DESC
        ), resolved_pair AS (
         SELECT p.phone_e164,
            p.meta_ad_id,
            c.candidate_id,
            c.meta_ad_name AS candidate_ad_name,
            c.meta_adset_id AS candidate_adset_id,
            c.meta_adset_name AS candidate_adset_name,
            c.meta_campaign_id AS candidate_campaign_id,
            c.meta_campaign_name AS candidate_campaign_name,
            c.first_seen_at,
            c.last_seen_at,
            c.reconciliation_status AS candidate_reconciliation_status,
                CASE
                    WHEN ((c.candidate_id IS NOT NULL) AND (le.crm_lead_id IS NOT NULL)) THEN 'messenger_and_crm'::text
                    WHEN (c.candidate_id IS NOT NULL) THEN 'messenger_candidate'::text
                    ELSE 'crm_lead'::text
                END AS source_type,
            COALESCE(le.crm_lead_id, r.selected_crm_lead_id) AS resolved_crm_lead_id,
                CASE
                    WHEN (le.crm_lead_id IS NOT NULL) THEN 'exact_phone_ad'::text
                    WHEN (r.selected_crm_lead_id IS NOT NULL) THEN 'manual_reconciliation'::text
                    ELSE 'unmatched'::text
                END AS crm_match_method
           FROM ((((phone_ad_pairs p
             LEFT JOIN candidate_latest c ON (((c.phone_e164 = p.phone_e164) AND (c.meta_ad_id = p.meta_ad_id))))
             LEFT JOIN lead_latest le ON (((le.phone_e164 = p.phone_e164) AND (le.meta_ad_id = p.meta_ad_id))))
             LEFT JOIN meta_call_center_reconciliation r ON ((r.meta_candidate_id = c.candidate_id) AND r.review_status IN('confirmed_same_person','duplicate_resolved') AND r.reviewed_at IS NOT NULL AND c.reconciliation_status='matched'))
             LEFT JOIN unique_phone_lead ul ON ((ul.phone_e164 = p.phone_e164)))
        ), appointment_agg AS (
         SELECT a.lead_id,
            (count(*))::integer AS appointment_count,
            (count(*) FILTER (WHERE (COALESCE(a.appointment_status, ''::text) <> 'Cancelled'::text)))::integer AS booked_appointment_count,
            min(a.appointment_date) AS first_appointment_date,
            max(a.appointment_date) AS latest_appointment_date,
            (array_agg(a.appointment_status ORDER BY a.appointment_date DESC NULLS LAST, a.id DESC))[1] AS latest_appointment_status,
            (count(*) FILTER (WHERE (a.appointment_status = 'No-show'::text)))::integer AS no_show_count,
            bool_or(EXISTS(SELECT 1 FROM mis_internal.shadow_appointment_outcomes verified WHERE verified.appointment_id=a.id AND verified.evidence_outcome='invoice_verified_attended')) AS appointment_showed_up
           FROM crm_appointments a
          WHERE (a.lead_id IS NOT NULL)
          GROUP BY a.lead_id
        ), resolved_with_lead AS (
         SELECT rp.phone_e164,
            rp.meta_ad_id,
            rp.candidate_id,
            rp.candidate_ad_name,
            rp.candidate_adset_id,
            rp.candidate_adset_name,
            rp.candidate_campaign_id,
            rp.candidate_campaign_name,
            rp.first_seen_at,
            rp.last_seen_at,
            rp.candidate_reconciliation_status,
            rp.source_type,
            rp.resolved_crm_lead_id,
            rp.crm_match_method,
            l.patient_id,
            l.lead_name,
            l.lead_status,
            l.meta_ad_id AS crm_effective_ad_id,
            l.meta_ad_id_source,
            l.meta_ad_id_resolution_status,
            l.meta_ad_id_conflict,
            COALESCE(LEAST((rp.first_seen_at)::date, (l.created_at)::date), (rp.first_seen_at)::date, (l.created_at)::date) AS attribution_date,
            row_number() OVER(PARTITION BY l.patient_id,rp.meta_ad_id ORDER BY
             CASE WHEN rp.crm_match_method='manual_reconciliation' THEN 0 ELSE 1 END,
             rp.first_seen_at NULLS LAST,rp.phone_e164,rp.resolved_crm_lead_id) AS revenue_rank
           FROM (resolved_pair rp
             LEFT JOIN crm_leads l ON ((l.id = rp.resolved_crm_lead_id)))
        )
 SELECT x.phone_e164,
    "right"(x.phone_e164, 4) AS phone_last4,
    x.meta_ad_id,
    COALESCE(x.candidate_ad_name, am.ad_name) AS meta_ad_name,
    COALESCE(x.candidate_adset_id, am.adset_id) AS meta_adset_id,
    COALESCE(x.candidate_adset_name, am.adset_name) AS meta_adset_name,
    COALESCE(x.candidate_campaign_id, am.campaign_id,(SELECT p.campaign_id FROM public.patient_marketing_attribution p WHERE p.patient_id=x.patient_id AND p.acquisition_ad_id=x.meta_ad_id AND p.attribution_status='eligible_source')) AS meta_campaign_id,
    COALESCE(x.candidate_campaign_name, am.campaign_name,(SELECT p.campaign_name FROM public.patient_marketing_attribution p WHERE p.patient_id=x.patient_id AND p.acquisition_ad_id=x.meta_ad_id AND p.attribution_status='eligible_source')) AS meta_campaign_name,
    x.source_type,
    x.candidate_id,
    x.resolved_crm_lead_id AS crm_lead_id,
    x.patient_id,
    x.lead_name,
    x.lead_status,
    x.crm_effective_ad_id,
    COALESCE(x.meta_ad_id_source,
        CASE
            WHEN (x.candidate_id IS NOT NULL) THEN 'meta_message_candidate'::text
            ELSE NULL::text
        END) AS attribution_source,
    COALESCE(x.meta_ad_id_resolution_status, x.candidate_reconciliation_status) AS attribution_resolution_status,
    (COALESCE(x.meta_ad_id_conflict, false) OR ((x.crm_effective_ad_id IS NOT NULL) AND (x.crm_effective_ad_id <> x.meta_ad_id))) AS ad_conflict,
    x.crm_match_method,
    x.attribution_date,
    x.first_seen_at,
    x.last_seen_at,
    COALESCE(ap.appointment_count, 0) AS appointment_count,
    COALESCE(ap.booked_appointment_count, 0) AS booked_appointment_count,
    (COALESCE(ap.booked_appointment_count, 0) > 0) AS has_appointment,
    ap.first_appointment_date,
    ap.latest_appointment_date,
    ap.latest_appointment_status,
    COALESCE(ap.no_show_count, 0) AS no_show_count,
    COALESCE(ap.appointment_showed_up, false) AS showed_up,
        CASE
            WHEN COALESCE(ap.appointment_showed_up, false) THEN 'mis_patient_date_doctor_verified_appointment'::text
            ELSE NULL::text
        END AS show_up_evidence,
    COALESCE(rv.invoice_count, 0) AS invoice_count,
    rv.first_invoice_date,
    rv.last_invoice_date,
    (COALESCE(rv.net_revenue_bdt, (0)::numeric))::numeric(18,2) AS net_revenue_bdt,
    (COALESCE(rv.cash_collected_bdt, (0)::numeric))::numeric(18,2) AS cash_collected_bdt,
    now() AS refreshed_at
   FROM (((resolved_with_lead x
     LEFT JOIN ad_metadata am ON ((am.ad_id = x.meta_ad_id)))
     LEFT JOIN appointment_agg ap ON ((ap.lead_id = x.resolved_crm_lead_id)))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS invoice_count,
            min(i.invoice_date) AS first_invoice_date,
            max(i.invoice_date) AS last_invoice_date,
            COALESCE(sum(i.net_bill), (0)::numeric) AS net_revenue_bdt,
            COALESCE(sum(i.total_collected), (0)::numeric) AS cash_collected_bdt
           FROM invoices i
          WHERE (x.revenue_rank=1 AND coalesce(x.meta_ad_id_conflict,false)=false
            AND EXISTS(SELECT 1 FROM public.patient_marketing_attribution pma WHERE pma.patient_id=i.patient_id
             AND pma.attribution_status='eligible_source' AND pma.acquisition_ad_id=x.meta_ad_id
             AND i.invoice_date>=pma.first_touch_date)
            AND (i.patient_id = x.patient_id) AND (i.invoice_date IS NOT NULL)  AND (i.invoice_status <> ALL (ARRAY['cancelled'::text, 'void'::text])) AND (i.invoice_type <> 'refund'::text) AND (NOT (EXISTS ( SELECT 1
                   FROM excluded_billing_invoices e
                  WHERE (e.invoice_id = i.id)))) AND (NOT (EXISTS ( SELECT 1
                   FROM backlog_patient_invoices b
                  WHERE (b.invoice_id = i.id)))))) rv ON (true));
CREATE OR REPLACE FUNCTION public.refresh_meta_ad_outcome_daily_snapshot()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_rows integer;
begin
  delete from public.meta_ad_outcome_daily_snapshots where snapshot_date=current_date;
  insert into public.meta_ad_outcome_daily_snapshots (
    snapshot_date, meta_ad_id, meta_ad_name, meta_adset_id, meta_adset_name,
    meta_campaign_id, meta_campaign_name, phone_ad_pairs, crm_leads,
    matched_patients, leads_with_appointment, appointment_count,
    showed_up_leads, no_show_count, revenue_patients, net_revenue_bdt,
    cash_collected_bdt, attribution_conflicts, unmatched_phone_ad_pairs,
    refreshed_at
  )
  select
    current_date,
    o.meta_ad_id,
    max(o.meta_ad_name),
    max(o.meta_adset_id),
    max(o.meta_adset_name),
    max(o.meta_campaign_id),
    max(o.meta_campaign_name),
    count(*)::integer,
    count(distinct o.crm_lead_id) filter (where o.crm_lead_id is not null)::integer,
    count(distinct o.patient_id) filter (where o.patient_id is not null)::integer,
    count(distinct o.crm_lead_id) filter (where o.has_appointment)::integer,
    sum(o.appointment_count)::integer,
    count(distinct o.crm_lead_id) filter (where o.showed_up)::integer,
    sum(o.no_show_count)::integer,
    count(distinct o.patient_id) filter (where o.net_revenue_bdt > 0 or o.cash_collected_bdt > 0)::integer,
    coalesce(sum(o.net_revenue_bdt),0)::numeric(18,2),
    coalesce(sum(o.cash_collected_bdt),0)::numeric(18,2),
    count(*) filter (where o.ad_conflict)::integer,
    count(*) filter (where o.crm_lead_id is null)::integer,
    now()
  from public.meta_phone_ad_outcomes_current o
  group by o.meta_ad_id
  on conflict (snapshot_date, meta_ad_id) do update set
    meta_ad_name = excluded.meta_ad_name,
    meta_adset_id = excluded.meta_adset_id,
    meta_adset_name = excluded.meta_adset_name,
    meta_campaign_id = excluded.meta_campaign_id,
    meta_campaign_name = excluded.meta_campaign_name,
    phone_ad_pairs = excluded.phone_ad_pairs,
    crm_leads = excluded.crm_leads,
    matched_patients = excluded.matched_patients,
    leads_with_appointment = excluded.leads_with_appointment,
    appointment_count = excluded.appointment_count,
    showed_up_leads = excluded.showed_up_leads,
    no_show_count = excluded.no_show_count,
    revenue_patients = excluded.revenue_patients,
    net_revenue_bdt = excluded.net_revenue_bdt,
    cash_collected_bdt = excluded.cash_collected_bdt,
    attribution_conflicts = excluded.attribution_conflicts,
    unmatched_phone_ad_pairs = excluded.unmatched_phone_ad_pairs,
    refreshed_at = excluded.refreshed_at;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;
CREATE OR REPLACE FUNCTION public.refresh_meta_phone_ad_outcomes_detail()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_rows integer;
begin
  delete from public.meta_phone_ad_outcomes_current where true;
  insert into public.meta_phone_ad_outcomes_current
  select * from public.vw_meta_phone_ad_outcome_source;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;
CREATE OR REPLACE FUNCTION public.refresh_meta_phone_ad_outcomes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_detail integer;
  v_snapshot integer;
begin
  v_detail := public.refresh_meta_phone_ad_outcomes_detail();
  v_snapshot := public.refresh_meta_ad_outcome_daily_snapshot();
  return jsonb_build_object(
    'detail_rows', v_detail,
    'snapshot_rows', v_snapshot,
    'snapshot_date', current_date,
    'refreshed_at', now()
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_source_performance(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;

  WITH
  lead_src AS (
    SELECT cl.id, cl.patient_id,
      coalesce((SELECT min(e.event_date)::timestamp AT TIME ZONE 'Asia/Dhaka'
       FROM mis_internal.marketing_source_evidence_v2 e WHERE e.evidence_table='crm_leads' AND e.evidence_id=cl.id::text),cl.created_at) created_at, cl.agent_name,
      CASE
        WHEN coalesce(nullif(la.source_category, ''), nullif(cl.source, '')) ILIKE '%facebook%' THEN 'Facebook'
        ELSE initcap(coalesce(nullif(la.source_category, ''), nullif(cl.source, ''), 'Unknown'))
      END AS source_name,
      public.call_kpi_patient_type_label(cl.patient_type) AS patient_type_label
    FROM crm_leads cl
    LEFT JOIN lead_attribution la ON la.lead_id = cl.id
  ),
  appts AS (
    SELECT ca.id, ca.appointment_date, ca.appointment_status, ca.patient_id, ls.source_name, ls.patient_type_label
    FROM crm_appointments ca
    JOIN lead_src ls ON ls.id = ca.lead_id
    WHERE ca.appointment_date BETWEEN p_start_date AND p_end_date

    UNION ALL

    SELECT ca.id, ca.appointment_date, ca.appointment_status, ca.patient_id,
      'Outbound Follow-up' AS source_name,
      public.call_kpi_patient_type_label(pt.patient_type) AS patient_type_label
    FROM crm_appointments ca
    LEFT JOIN patients pt ON pt.id = ca.patient_id
    WHERE ca.lead_id IS NULL AND ca.outbound_attempt_id IS NOT NULL
      AND ca.appointment_date BETWEEN p_start_date AND p_end_date

    UNION ALL

    SELECT ca.id, ca.appointment_date, ca.appointment_status, ca.patient_id,
      'Unattributed / Historical' AS source_name,
      public.call_kpi_patient_type_label(pt.patient_type) AS patient_type_label
    FROM crm_appointments ca
    LEFT JOIN patients pt ON pt.id = ca.patient_id
    WHERE ca.lead_id IS NULL AND ca.outbound_attempt_id IS NULL
      AND ca.appointment_date BETWEEN p_start_date AND p_end_date
  ),
  leads_agg AS (
    SELECT source_name,
      count(*) AS leads,
      count(*) FILTER (WHERE patient_type_label = 'New') AS new_leads,
      count(*) FILTER (WHERE patient_type_label = 'Old') AS old_leads
    FROM lead_src
    WHERE created_at::date BETWEEN p_start_date AND p_end_date
    GROUP BY source_name
  ),
  -- Per-source appointment counts, eligibility, and no-shows, each also
  -- split New vs Old so the per-source funnel can show two bars per stage
  -- instead of one combined number.
  appts_flags AS (
    SELECT a.*,
      (a.appointment_date < current_date AND a.appointment_status NOT IN ('Cancelled','Rescheduled')) AS is_eligible,
        (a.appointment_status='No-show' AND NOT EXISTS(SELECT 1 FROM mis_internal.shadow_appointment_outcomes o WHERE o.appointment_id=a.id AND o.evidence_outcome='invoice_verified_attended')) AS is_no_show,
        EXISTS(SELECT 1 FROM mis_internal.shadow_appointment_outcomes o WHERE o.appointment_id=a.id AND o.evidence_outcome='invoice_verified_attended') AS is_attended
    FROM appts a
  ),
  appts_agg AS (
    SELECT source_name,
      count(*) AS appts_cnt,
      count(*) FILTER (WHERE patient_type_label = 'New') AS new_appts_cnt,
      count(*) FILTER (WHERE patient_type_label <> 'New') AS old_appts_cnt,
      count(*) FILTER (WHERE is_eligible) AS eligible_cnt,
      count(*) FILTER (WHERE is_no_show) AS no_show_cnt,
      count(*) FILTER (WHERE is_attended AND patient_type_label='New') AS new_attended,
      count(*) FILTER (WHERE is_attended AND patient_type_label<>'New') AS old_attended
    FROM appts_flags
    GROUP BY source_name
  ),
  revenue AS (
    SELECT CASE WHEN i.attributed_source='facebook' THEN 'Facebook'
      WHEN i.attributed_source IS NULL THEN 'Unattributed / Historical'
      ELSE initcap(i.attributed_source) END source_name,
      sum(i.net_bill) FILTER(WHERE i.invoice_date=p.first_clinical_invoice_date) revenue_new,
      sum(i.net_bill) FILTER(WHERE i.invoice_date IS DISTINCT FROM p.first_clinical_invoice_date) revenue_followup
    FROM mis_internal.shadow_invoice_attribution i
    JOIN mis_internal.shadow_patient_acquisitions p USING(patient_id)
    WHERE i.invoice_date BETWEEN p_start_date AND p_end_date GROUP BY 1
  ),
  pt_leads AS (
    SELECT patient_type_label, count(*) AS leads_cnt
    FROM lead_src
    WHERE created_at::date BETWEEN p_start_date AND p_end_date
    GROUP BY patient_type_label
  ),
  pt_appts AS (
    SELECT patient_type_label,
      count(*) AS appts_cnt,
      count(*) FILTER (WHERE appointment_date < current_date AND appointment_status NOT IN ('Cancelled','Rescheduled')) AS eligible_cnt,
      count(*) FILTER (WHERE appointment_status='No-show') AS no_show_cnt,
      count(*) FILTER (WHERE EXISTS(SELECT 1 FROM mis_internal.shadow_appointment_outcomes o WHERE o.appointment_id=appts.id AND o.evidence_outcome='invoice_verified_attended')) AS attended_cnt
    FROM appts
    GROUP BY patient_type_label
  ),
  first_appt AS (
    SELECT ca.lead_id, min(ca.appointment_date) AS first_appt_date
    FROM crm_appointments ca
    WHERE ca.lead_id IS NOT NULL
    GROUP BY ca.lead_id
  ),
  tta AS (
    SELECT ls.source_name,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY (fa.first_appt_date - ls.created_at::date)) AS median_days,
      avg(fa.first_appt_date - ls.created_at::date) AS avg_days,
      count(*) AS n
    FROM lead_src ls
    JOIN first_appt fa ON fa.lead_id = ls.id
    WHERE ls.created_at::date BETWEEN p_start_date AND p_end_date
      AND fa.first_appt_date >= ls.created_at::date
    GROUP BY ls.source_name
  ),
  matrix AS (
    SELECT source_name, coalesce(agent_name, 'Unassigned') AS agent_name, count(*) AS leads
    FROM lead_src
    WHERE created_at::date BETWEEN p_start_date AND p_end_date
    GROUP BY source_name, coalesce(agent_name, 'Unassigned')
  )
  SELECT jsonb_build_object(
    'period_start', p_start_date,
    'period_end', p_end_date,
    'sources', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'source', coalesce(la.source_name, aa.source_name, r.source_name),
        'leads', coalesce(la.leads, 0),
        'new_leads', coalesce(la.new_leads, 0),
        'old_leads', coalesce(la.old_leads, 0),
        'appointments_set', coalesce(aa.appts_cnt, 0),
        'new_appointments_set', coalesce(aa.new_appts_cnt, 0),
        'old_appointments_set', coalesce(aa.old_appts_cnt, 0),
        'appointments_eligible', coalesce(aa.eligible_cnt, 0),
        'no_shows', coalesce(aa.no_show_cnt, 0),
        'no_show_rate', round(100.0 * coalesce(aa.no_show_cnt, 0) / NULLIF(aa.eligible_cnt, 0), 1),
        'new_attended', coalesce(aa.new_attended, 0),
        'old_attended', coalesce(aa.old_attended, 0),
        'revenue_new', coalesce(r.revenue_new, 0),
        'revenue_followup', coalesce(r.revenue_followup, 0)
      ) ORDER BY coalesce(la.leads, 0) DESC)
      FROM leads_agg la
      FULL OUTER JOIN appts_agg aa ON aa.source_name = la.source_name
      FULL OUTER JOIN revenue r ON r.source_name = coalesce(la.source_name, aa.source_name)
    ), '[]'::jsonb),
    'patient_type_funnel', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'type', coalesce(l.patient_type_label, a.patient_type_label),
        'leads', coalesce(l.leads_cnt, 0),
        'appointments_set', coalesce(a.appts_cnt, 0),
        'attended', coalesce(a.attended_cnt, 0)
      ))
      FROM pt_leads l
      FULL OUTER JOIN pt_appts a ON a.patient_type_label = l.patient_type_label
    ), '[]'::jsonb),
    'time_to_appointment', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'source', source_name,
        'median_days', round(median_days::numeric, 1),
        'avg_days', round(avg_days::numeric, 1),
        'n', n
      ) ORDER BY median_days)
      FROM tta
    ), '[]'::jsonb),
    'source_agent_matrix', coalesce((
      SELECT jsonb_agg(jsonb_build_object('source', source_name, 'agent', agent_name, 'leads', leads))
      FROM matrix
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION mis_internal.mis_gateway_status(p_actor_id uuid, p_upload_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r jsonb;
BEGIN
 PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);
 SELECT jsonb_build_object('batchId',b.id,'acceptedAt',b.accepted_at,'authority',b.authority,
  'invoices',count(j.id),'completed',count(*) FILTER(WHERE j.status='completed'),
  'superseded',count(*) FILTER(WHERE j.status='superseded'),'failed',count(*) FILTER(WHERE j.status='failed'),
  'pending',count(*) FILTER(WHERE j.status='pending'),'attempts',COALESCE(sum(j.attempts),0),
  'published',pub.published_batch_id>=b.id AND pub.rules_version='marketing_pipeline_v2'
    AND pub.marketing_revision=(SELECT revision FROM mis_internal.marketing_reconciliation_state WHERE singleton),
  'publicationStage',CASE WHEN pub.stage='complete' AND pub.marketing_revision<(SELECT revision FROM mis_internal.marketing_reconciliation_state WHERE singleton) THEN 'queued_marketing' ELSE pub.stage END,
  'publicationResult',pub.last_result,
  'marketingRun',(SELECT jsonb_build_object('status',m.status,'patientsProcessed',m.patients_processed,'metrics',m.metrics) FROM mis_internal.marketing_reconciliation_runs m ORDER BY m.id DESC LIMIT 1),
  'marketingFreshness',mis_internal.marketing_source_health(),
  'attributionCoverage',(SELECT findings->'attribution_breakdown' FROM mis_internal.shadow_attribution_runs WHERE status='completed' ORDER BY id DESC LIMIT 1),
  'errorCodes',COALESCE(jsonb_agg(DISTINCT j.error_code) FILTER(WHERE j.error_code IS NOT NULL),'[]'::jsonb))
 INTO r FROM mis_internal.mis_gateway_batches b JOIN mis_internal.mis_upload_parses p ON p.id=b.parse_id
 JOIN mis_internal.mis_gateway_jobs j ON j.batch_id=b.id CROSS JOIN mis_internal.mis_gateway_publication pub
 WHERE p.upload_id=p_upload_id GROUP BY b.id,pub.published_batch_id,pub.stage,pub.last_result,pub.rules_version,pub.marketing_revision ORDER BY b.id DESC LIMIT 1;
 RETURN r;
END $function$;


CREATE OR REPLACE VIEW public.vw_finance_invoice_marketing WITH(security_invoker=true) AS
SELECT i.id invoice_id,
 CASE WHEN a.attribution_status='eligible_source' AND i.invoice_date>=a.first_touch_date THEN a.validated_source END raw_source,
 'source_evidence_v2'::text attribution_method,
 CASE WHEN a.attribution_status='eligible_source' AND i.invoice_date>=a.first_touch_date THEN a.validated_source ELSE 'unattributed' END source_category,
 CASE WHEN a.attribution_status='eligible_source' AND i.invoice_date>=a.first_touch_date THEN a.campaign_name END campaign_bucket,
 CASE WHEN a.attribution_status='eligible_source' AND i.invoice_date>=a.first_touch_date THEN a.confidence END confidence,
 i.net_bill::numeric crm_attributed_revenue
FROM public.invoices i LEFT JOIN public.patient_marketing_attribution a ON a.patient_id=i.patient_id
WHERE i.invoice_status NOT IN('void','cancelled');

CREATE OR REPLACE FUNCTION public.get_ad_attribution_report(p_start_date date,p_end_date date) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=auth.uid() AND role='admin' AND is_active) THEN
  RAISE EXCEPTION 'Admin access required.'; END IF;
 WITH leads AS (
  SELECT a.meta_campaign_id campaign_id,a.meta_ad_id ad_id,max(a.meta_ad_name) ad_name,max(a.meta_campaign_name) campaign_name,
   count(distinct l.id) leads,count(distinct l.id) FILTER(WHERE EXISTS(SELECT 1 FROM public.crm_appointments p WHERE p.lead_id=l.id)) booked
  FROM public.lead_attribution a JOIN public.crm_leads l ON l.id=a.lead_id
  WHERE a.meta_campaign_id IS NOT NULL AND coalesce(
   (SELECT min(e.event_date) FROM mis_internal.marketing_source_evidence_v2 e WHERE e.evidence_table='crm_leads' AND e.evidence_id=l.id::text),
   (l.created_at AT TIME ZONE 'Asia/Dhaka')::date) BETWEEN p_start_date AND p_end_date
  GROUP BY 1,2
 ), appointments AS (
  SELECT a.meta_campaign_id campaign_id,a.meta_ad_id ad_id,count(distinct p.id) appointments,
   count(distinct p.id) FILTER(WHERE o.evidence_outcome='invoice_verified_attended') completed
  FROM public.lead_attribution a JOIN public.crm_appointments p ON p.lead_id=a.lead_id
  LEFT JOIN mis_internal.shadow_appointment_outcomes o ON o.appointment_id=p.id
  WHERE a.meta_campaign_id IS NOT NULL AND p.appointment_date BETWEEN p_start_date AND p_end_date GROUP BY 1,2
 ), revenue AS (
  SELECT a.campaign_id,a.acquisition_ad_id ad_id,max(a.campaign_name) campaign_name,sum(i.net_bill) revenue
  FROM public.patient_marketing_attribution a JOIN public.invoices i ON i.patient_id=a.patient_id
  WHERE a.attribution_status='eligible_source' AND a.campaign_id IS NOT NULL
   AND i.invoice_date>=a.first_touch_date AND i.invoice_date BETWEEN p_start_date AND p_end_date
   AND i.reconciliation_status='matched' AND i.invoice_status NOT IN('void','cancelled') GROUP BY 1,2
 ), keys AS (
  SELECT campaign_id,ad_id FROM leads UNION SELECT campaign_id,ad_id FROM appointments UNION SELECT campaign_id,ad_id FROM revenue
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('campaign_id',k.campaign_id,'ad_id',k.ad_id,'ad_name',l.ad_name,
  'campaign_name',coalesce(l.campaign_name,r.campaign_name),'leads',coalesce(l.leads,0),'booked',coalesce(l.booked,0),
  'appointments',coalesce(p.appointments,0),'completed',coalesce(p.completed,0),'revenue',coalesce(r.revenue,0))
  ORDER BY coalesce(l.leads,0) DESC),'[]') INTO result
 FROM keys k LEFT JOIN leads l ON l.campaign_id=k.campaign_id AND l.ad_id IS NOT DISTINCT FROM k.ad_id
 LEFT JOIN appointments p ON p.campaign_id=k.campaign_id AND p.ad_id IS NOT DISTINCT FROM k.ad_id
 LEFT JOIN revenue r ON r.campaign_id=k.campaign_id AND r.ad_id IS NOT DISTINCT FROM k.ad_id;
 RETURN result;
END $fn$;

CREATE OR REPLACE FUNCTION mis_internal.mis_gateway_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '120s'
 SET lock_timeout TO '2s'
AS $function$
DECLARE j mis_internal.mis_gateway_jobs%rowtype; r jsonb; pub mis_internal.mis_gateway_publication%rowtype;
 target bigint; snap record; n integer:=0; err text;
BEGIN
 IF COALESCE(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 IF NOT mis_internal.is_overnight() THEN RETURN jsonb_build_object('status','outside_overnight_window'); END IF;
 -- Same lock as legacy source processing plus a gateway enqueue/publication barrier.
 IF NOT pg_try_advisory_xact_lock(806731,7001) OR NOT pg_try_advisory_xact_lock(806731,7100) THEN RETURN jsonb_build_object('status','busy'); END IF;
 -- Cooperate with all existing downstream workers/finalizers.
 FOREACH n IN ARRAY ARRAY[7002,7003,7010,7020,7030,7031] LOOP
  IF NOT pg_try_advisory_xact_lock(806731,n) THEN RETURN jsonb_build_object('status','busy'); END IF;
 END LOOP;
 UPDATE mis_internal.mis_gateway_jobs older SET status='superseded',completed_at=now()
 WHERE status IN ('pending','failed') AND EXISTS(SELECT 1 FROM mis_internal.mis_gateway_jobs newer
  WHERE newer.invoice_key=older.invoice_key AND newer.batch_id>older.batch_id AND newer.status='completed');
 SELECT * INTO j FROM mis_internal.mis_gateway_jobs WHERE status='pending' AND next_attempt_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF FOUND THEN
  BEGIN
   r:=mis_internal.apply_gateway_invoice(j.id);
   INSERT INTO mis_internal.mis_gateway_events(job_id,event) VALUES(j.id,r->>'status');
   RETURN r||jsonb_build_object('jobId',j.id);
  EXCEPTION WHEN query_canceled OR OTHERS THEN
   GET STACKED DIAGNOSTICS err=RETURNED_SQLSTATE;
   INSERT INTO mis_internal.mis_gateway_events(job_id,event,code) VALUES(j.id,'attempt_failed',err);
   UPDATE mis_internal.mis_gateway_jobs SET attempts=attempts+1,error_code=err,
    status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END,
    next_attempt_at=now()+make_interval(secs=>least(900,30*(2^attempts)::integer)) WHERE id=j.id;
   RETURN jsonb_build_object('status','retry','jobId',j.id,'code',err);
  END;
 END IF;
 IF EXISTS(SELECT 1 FROM mis_internal.mis_gateway_jobs WHERE status IN ('pending','failed')) THEN RETURN jsonb_build_object('status','awaiting_jobs'); END IF;
 SELECT max(id) INTO target FROM mis_internal.mis_gateway_batches;
 SELECT * INTO pub FROM mis_internal.mis_gateway_publication WHERE singleton FOR UPDATE;
 IF target IS NULL OR (pub.published_batch_id>=target AND pub.rules_version='marketing_pipeline_v2'
  AND pub.marketing_revision=(SELECT revision FROM mis_internal.marketing_reconciliation_state WHERE singleton))
 THEN RETURN jsonb_build_object('status','idle'); END IF;
 IF pub.target_batch_id<>target OR pub.rules_version<>'marketing_pipeline_v2' THEN
  UPDATE mis_internal.mis_gateway_publication SET target_batch_id=target,stage='finance',snapshot_after='' WHERE singleton RETURNING * INTO pub;
 ELSIF pub.stage='complete' THEN
  UPDATE mis_internal.mis_gateway_publication SET stage='marketing',snapshot_after='' WHERE singleton RETURNING * INTO pub;
 END IF;
 PERFORM set_config('app.mis_worker','on',true);
 PERFORM set_config('app.mis_gateway_publish','on',true);
 BEGIN
  IF pub.stage='finance' THEN
   r:=public.refresh_finance_derived_data();
   UPDATE mis_internal.mis_gateway_publication SET stage='marketing',rules_version='marketing_pipeline_v2' WHERE singleton;
  ELSIF pub.stage='marketing' THEN
   r:=mis_internal.refresh_gateway_marketing_attribution(target,100);
   IF r->>'status'='completed' THEN UPDATE mis_internal.mis_gateway_publication
    SET stage='lifetime',marketing_revision=(r->>'source_revision')::bigint,marketing_run_id=(r->>'run_id')::bigint WHERE singleton; END IF;
  ELSIF pub.stage='lifetime' THEN
   r:=mis_internal.refresh_shadow_lifetime_attribution();
   IF r->>'status'='completed' THEN UPDATE mis_internal.mis_gateway_publication SET stage='contacts' WHERE singleton; END IF;
  ELSIF pub.stage='contacts' THEN
   r:=mis_internal.refresh_crm_contact_history_v2();
   IF r->>'status'='completed' THEN UPDATE mis_internal.mis_gateway_publication SET stage='ad_outcomes' WHERE singleton; END IF;
  ELSIF pub.stage='ad_outcomes' THEN
   r:=public.refresh_meta_phone_ad_outcomes()||jsonb_build_object('status','completed');
   UPDATE mis_internal.mis_gateway_publication SET stage='snapshots' WHERE singleton;
  ELSIF pub.stage='snapshots' THEN
   n:=0;
   -- Refresh all existing windows, including same-day historical corrections.
   FOR snap IN SELECT snapshot_key,start_date,end_date FROM public.dashboard_metric_snapshots
     WHERE snapshot_key>pub.snapshot_after ORDER BY snapshot_key LIMIT 5 LOOP
    PERFORM public.refresh_dashboard_metric_snapshot_cron(snap.start_date,snap.end_date);
    UPDATE mis_internal.mis_gateway_publication SET snapshot_after=snap.snapshot_key WHERE singleton;
    n:=n+1;
   END LOOP;
   r:=jsonb_build_object('status','completed','snapshots',n);
   IF n<5 THEN
    IF pub.marketing_revision<>(SELECT revision FROM mis_internal.marketing_reconciliation_state WHERE singleton) THEN
     UPDATE mis_internal.mis_gateway_publication SET stage='marketing',snapshot_after='' WHERE singleton;
     r:=jsonb_build_object('status','step_completed','reason','source_evidence_changed');
    ELSE
     IF EXISTS(SELECT 1 FROM public.invoices i LEFT JOIN mis_internal.shadow_invoice_attribution a ON a.invoice_id=i.id
      WHERE a.invoice_id IS NULL OR a.patient_id IS DISTINCT FROM i.patient_id OR a.net_bill IS DISTINCT FROM i.net_bill)
      OR NOT EXISTS(SELECT 1 FROM mis_internal.shadow_attribution_runs WHERE id=(SELECT max(id) FROM mis_internal.shadow_attribution_runs) AND status='completed' AND integrity_passed)
     THEN RAISE EXCEPTION 'Publication integrity check failed'; END IF;
     UPDATE mis_internal.mis_gateway_publication SET stage='complete',published_batch_id=target,rules_version='marketing_pipeline_v2' WHERE singleton;
    END IF;
   END IF;
  END IF;
  UPDATE mis_internal.mis_gateway_publication SET last_result=r-'error',updated_at=now() WHERE singleton;
  RETURN jsonb_build_object('status',CASE WHEN COALESCE(r->>'status','completed') IN ('completed','step_completed') THEN 'advanced' ELSE 'deferred' END,'stage',pub.stage);
 EXCEPTION WHEN query_canceled OR OTHERS THEN
  GET STACKED DIAGNOSTICS err=RETURNED_SQLSTATE;
  UPDATE mis_internal.mis_gateway_publication SET last_result=jsonb_build_object('status','failed','code',err),updated_at=now() WHERE singleton;
  RETURN jsonb_build_object('status','deferred','stage',pub.stage,'code',err);
 END;
END $function$;

CREATE OR REPLACE FUNCTION mis_internal.refresh_shadow_lifetime_attribution()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'mis_internal'
 SET statement_timeout TO '110s'
 SET lock_timeout TO '2s'
AS $function$
DECLARE
 v_run bigint; v_step text; v_min date; v_max date; v_pending integer;
 v_invoices integer; v_patients integer; v_encounters integer; v_appointments integer;
 v_net numeric; v_collected numeric; v_attr numeric; v_unattr numeric;
 v_good boolean; v_history_start date;
BEGIN
 IF mis_internal.gateway_publication_blocked() THEN RETURN jsonb_build_object('status','deferred_gateway'); END IF;
 IF NOT mis_internal.is_overnight() THEN RETURN jsonb_build_object('status','outside_overnight_window'); END IF;
 IF NOT pg_try_advisory_xact_lock(806731,7030) THEN RETURN jsonb_build_object('status','already_running'); END IF;

 SELECT id,refresh_step INTO v_run,v_step
 FROM mis_internal.shadow_attribution_runs
 WHERE status='running' ORDER BY id DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN
  SELECT min(invoice_date),max(invoice_date),count(*),count(distinct patient_id),sum(net_bill),sum(total_collected)
   INTO v_min,v_max,v_invoices,v_patients,v_net,v_collected
   FROM public.invoices WHERE reconciliation_status='matched';
  SELECT count(*) INTO v_pending FROM public.invoices WHERE reconciliation_status IS DISTINCT FROM 'matched';
  v_pending:=v_pending+(SELECT count(*) FROM mis_internal.downstream_repair_queue WHERE status<>'completed');
  IF v_pending>0 OR v_invoices=0
    OR v_invoices<>(SELECT count(distinct lower(btrim(invoice_id_raw))) FROM public.mis_reports)
    OR (SELECT count(*) FROM public.mis_reports)<>(SELECT count(*) FROM public.invoice_line_items)
    OR EXISTS(SELECT 1 FROM public.mis_report_imports WHERE status NOT IN ('completed','failed'))
    OR NOT EXISTS(SELECT 1 FROM public.mis_reconciliation_runs r
      WHERE r.mis_import_id=(SELECT max(id) FROM public.mis_report_imports WHERE status='completed') AND r.status='completed')
  THEN RETURN jsonb_build_object('status','deferred_upstream','unmatched_or_pending',v_pending); END IF;
  INSERT INTO mis_internal.shadow_attribution_runs(status,source_last_date,rule_version,refresh_step,findings)
   VALUES('running',v_max,'source_evidence_v2','clear',jsonb_build_object('history_start',v_min))
   RETURNING id INTO v_run;
  RETURN jsonb_build_object('status','step_completed','run_id',v_run,'step','clear');
 END IF;

 SELECT (findings->>'history_start')::date INTO v_history_start
 FROM mis_internal.shadow_attribution_runs WHERE id=v_run;

 IF v_step='clear' THEN
  DELETE FROM mis_internal.shadow_appointment_outcomes WHERE true;
  DELETE FROM mis_internal.shadow_invoice_attribution WHERE true;
  DELETE FROM mis_internal.shadow_patient_acquisitions WHERE true;
  DELETE FROM mis_internal.shadow_encounters WHERE true;
  DELETE FROM mis_internal.shadow_invoice_evidence WHERE true;
  UPDATE mis_internal.shadow_attribution_runs SET refresh_step='evidence' WHERE id=v_run;
  RETURN jsonb_build_object('status','step_completed','run_id',v_run,'step','evidence');
 ELSIF v_step='evidence' THEN
  WITH flagged AS (
   SELECT l.invoice_id,count(*) FILTER(WHERE
    lower(btrim(coalesce(l.category_name,''))) IN ('opd services','daycare consultation','ipd consultation','therapeutics','ot/surgery','ot room charges','ipd services','emergency service')
    OR lower(btrim(coalesce(l.item_type,'')))='procedure'
    OR lower(coalesce(l.particulars,'')) ~ '(consultation|dressing charge|hbot|vacuarc|wound screening|outpatient procedure|therapy session)') clinical_count
   FROM public.invoice_line_items l GROUP BY l.invoice_id
  )
  INSERT INTO mis_internal.shadow_invoice_evidence
   (invoice_id,patient_id,invoice_date,clinical_line_evidence,clinical_line_count,encounter_key,run_id)
  SELECT i.id,i.patient_id,i.invoice_date,
   (coalesce(f.clinical_count,0)>0 AND i.invoice_type IS DISTINCT FROM 'refund'),
   CASE WHEN i.invoice_type='refund' THEN 0 ELSE coalesce(f.clinical_count,0) END,
   CASE WHEN i.patient_type='IPD' OR i.invoice_type='ipd'
     THEN 'IPD:'||i.patient_id||':'||coalesce(i.admission_id::text,nullif(btrim(coalesce(i.an,'')),''),'day:'||i.invoice_date::text)
    WHEN i.invoice_type='refund' THEN 'ADJUSTMENT:'||i.id
    ELSE 'OUTPATIENT:'||i.patient_id||':'||i.invoice_date::text||':'||coalesce(mis_internal.doctor_match_key(i.consultant_name_raw),'invoice:'||i.id::text) END,
   v_run
  FROM public.invoices i LEFT JOIN flagged f ON f.invoice_id=i.id WHERE i.reconciliation_status='matched';
  UPDATE mis_internal.shadow_attribution_runs SET refresh_step='encounters' WHERE id=v_run;
  RETURN jsonb_build_object('status','step_completed','run_id',v_run,'step','encounters');
 ELSIF v_step='encounters' THEN
  INSERT INTO mis_internal.shadow_encounters
   (encounter_key,patient_id,care_setting,episode_start,episode_end,doctor_key,admission_id,invoice_count,clinical_invoice_count,clinical_verified,net_bill,total_collected,run_id)
  SELECT e.encounter_key,min(e.patient_id),
   CASE WHEN e.encounter_key LIKE 'IPD:%' THEN 'IPD' WHEN e.encounter_key LIKE 'ADJUSTMENT:%' THEN 'adjustment' ELSE 'outpatient_or_daycare' END,
   min(e.invoice_date),max(e.invoice_date),
   CASE WHEN e.encounter_key LIKE 'OUTPATIENT:%' THEN min(mis_internal.doctor_match_key(i.consultant_name_raw)) ELSE NULL END,
   min(i.admission_id),count(*),count(*) FILTER(WHERE e.clinical_line_evidence),bool_or(e.clinical_line_evidence),
   coalesce(sum(i.net_bill),0),coalesce(sum(i.total_collected),0),v_run
  FROM mis_internal.shadow_invoice_evidence e JOIN public.invoices i ON i.id=e.invoice_id GROUP BY e.encounter_key;
  UPDATE mis_internal.shadow_attribution_runs SET refresh_step='acquisitions' WHERE id=v_run;
  RETURN jsonb_build_object('status','step_completed','run_id',v_run,'step','acquisitions');
 ELSIF v_step='acquisitions' THEN
  WITH p_first AS (
   SELECT e.patient_id,min(e.invoice_date) first_invoice,min(e.invoice_date) FILTER(WHERE e.clinical_line_evidence) first_clinical
   FROM mis_internal.shadow_invoice_evidence e GROUP BY e.patient_id
  )
  INSERT INTO mis_internal.shadow_patient_acquisitions
   (patient_id,first_recorded_invoice_date,first_clinical_invoice_date,source,source_event_date,evidence_table,evidence_id,evidence_authentication,attribution_class,historical_window_start,notes,run_id)
  SELECT f.patient_id,f.first_invoice,f.first_clinical,
   CASE WHEN a.attribution_status='eligible_source' THEN a.first_touch_source END,
   a.first_touch_date,a.first_touch_evidence_table,a.first_touch_evidence_id,a.authentication_method,
   coalesce(a.attribution_status,'missing_source'),v_history_start,
   'Original source evidence; earliest authenticated eligible contact by date before first observed clinical conversion. Same-day ordering may be uncertain; historical coverage remains partial.',v_run
  FROM p_first f LEFT JOIN public.patient_marketing_attribution a ON a.patient_id=f.patient_id;
  UPDATE mis_internal.shadow_attribution_runs SET refresh_step='invoice_attribution' WHERE id=v_run;
  RETURN jsonb_build_object('status','step_completed','run_id',v_run,'step','invoice_attribution');
 ELSIF v_step='invoice_attribution' THEN
  INSERT INTO mis_internal.shadow_invoice_attribution(invoice_id,patient_id,invoice_date,encounter_key,attributed_source,attribution_class,net_bill,total_collected,run_id)
  SELECT i.id,i.patient_id,i.invoice_date,e.encounter_key,
   CASE WHEN i.invoice_date>=p.source_event_date THEN p.source END,
   CASE WHEN p.source IS NOT NULL AND i.invoice_date<p.source_event_date THEN 'pre_acquisition_invoice' ELSE p.attribution_class END,
   i.net_bill,i.total_collected,v_run
  FROM public.invoices i JOIN mis_internal.shadow_invoice_evidence e ON e.invoice_id=i.id
   JOIN mis_internal.shadow_patient_acquisitions p ON p.patient_id=i.patient_id;
  UPDATE mis_internal.shadow_attribution_runs SET refresh_step='appointments' WHERE id=v_run;
  RETURN jsonb_build_object('status','step_completed','run_id',v_run,'step','appointments');
 ELSIF v_step='appointments' THEN
  WITH appointments AS (
   SELECT a.id,a.patient_id,a.appointment_date,a.appointment_status,mis_internal.doctor_match_key(a.doctor_service) doctor_key FROM public.crm_appointments a
  ), bills AS (
   SELECT patient_id,invoice_date,count(*) any_bill FROM mis_internal.shadow_invoice_evidence GROUP BY patient_id,invoice_date
  ), clinical AS (
   SELECT e.patient_id,e.invoice_date,mis_internal.doctor_match_key(i.consultant_name_raw) doctor_key,count(*) exact_clinical
   FROM mis_internal.shadow_invoice_evidence e JOIN public.invoices i ON i.id=e.invoice_id
   WHERE e.clinical_line_evidence AND mis_internal.doctor_match_key(i.consultant_name_raw) IS NOT NULL
   GROUP BY e.patient_id,e.invoice_date,mis_internal.doctor_match_key(i.consultant_name_raw)
  ), same_doc AS (
   SELECT patient_id,appointment_date,doctor_key,count(*) same_doc_bookings FROM appointments WHERE doctor_key IS NOT NULL
   GROUP BY patient_id,appointment_date,doctor_key
  ), evidence AS (
   SELECT a.*,coalesce(b.any_bill,0) any_bill,coalesce(c.exact_clinical,0) exact_clinical,coalesce(d.same_doc_bookings,0) same_doc_bookings
   FROM appointments a LEFT JOIN bills b ON b.patient_id=a.patient_id AND b.invoice_date=a.appointment_date
    LEFT JOIN clinical c ON c.patient_id=a.patient_id AND c.invoice_date=a.appointment_date AND c.doctor_key=a.doctor_key
    LEFT JOIN same_doc d ON d.patient_id=a.patient_id AND d.appointment_date=a.appointment_date AND d.doctor_key=a.doctor_key
  )
  INSERT INTO mis_internal.shadow_appointment_outcomes
   (appointment_id,patient_id,appointment_date,existing_booking_status,matching_clinical_invoices,same_day_billing_invoices,duplicate_booking_count,evidence_outcome,run_id)
  SELECT id,patient_id,appointment_date,appointment_status,exact_clinical,any_bill,same_doc_bookings,
   CASE WHEN patient_id IS NULL THEN 'identity_unresolved'
    WHEN exact_clinical>0 AND same_doc_bookings>1 THEN 'ambiguous_booking_invoice_present'
    WHEN exact_clinical>0 THEN 'invoice_verified_attended'
    WHEN any_bill>0 THEN 'same_day_billing_not_visit_proof'
    WHEN appointment_date>(SELECT source_last_date FROM mis_internal.shadow_attribution_runs WHERE id=v_run) THEN 'awaiting_mis_coverage'
    WHEN appointment_date>(now() AT TIME ZONE 'Asia/Dhaka')::date-4 THEN 'pending_grace_period'
    ELSE 'no_qualifying_invoice_observed' END,v_run
  FROM evidence;
  UPDATE mis_internal.shadow_attribution_runs SET refresh_step='validate' WHERE id=v_run;
  RETURN jsonb_build_object('status','step_completed','run_id',v_run,'step','validate');
 ELSIF v_step='validate' THEN
  SELECT min(invoice_date),max(invoice_date),count(*),count(distinct patient_id),sum(net_bill),sum(total_collected)
   INTO v_min,v_max,v_invoices,v_patients,v_net,v_collected FROM public.invoices WHERE reconciliation_status='matched';
  SELECT count(*) INTO v_encounters FROM mis_internal.shadow_encounters;
  SELECT count(*) INTO v_appointments FROM mis_internal.shadow_appointment_outcomes;
  SELECT coalesce(sum(net_bill) FILTER(WHERE attributed_source IS NOT NULL),0),coalesce(sum(net_bill) FILTER(WHERE attributed_source IS NULL),0)
   INTO v_attr,v_unattr FROM mis_internal.shadow_invoice_attribution;
  v_good :=
   (SELECT count(*) FROM mis_internal.shadow_invoice_attribution)=v_invoices
   AND (SELECT count(*) FROM mis_internal.shadow_invoice_evidence)=v_invoices
   AND (SELECT count(*) FROM mis_internal.shadow_patient_acquisitions)=v_patients
   AND (SELECT count(*) FROM mis_internal.shadow_appointment_outcomes)=(SELECT count(*) FROM public.crm_appointments)
   AND (SELECT coalesce(sum(net_bill),0) FROM mis_internal.shadow_invoice_attribution)=v_net
   AND (SELECT coalesce(sum(total_collected),0) FROM mis_internal.shadow_invoice_attribution)=v_collected
   AND v_attr+v_unattr=v_net
   AND NOT EXISTS(SELECT 1 FROM mis_internal.shadow_invoice_attribution a JOIN public.invoices i ON i.id=a.invoice_id
    WHERE a.patient_id<>i.patient_id OR a.net_bill IS DISTINCT FROM i.net_bill OR a.total_collected IS DISTINCT FROM i.total_collected);
  IF EXISTS(SELECT 1 FROM mis_internal.shadow_invoice_attribution a JOIN mis_internal.shadow_patient_acquisitions p USING(patient_id) WHERE a.attributed_source IS NOT NULL AND a.invoice_date<p.source_event_date) THEN RAISE EXCEPTION 'Revenue predates acquisition evidence'; END IF;
  IF NOT v_good THEN RAISE EXCEPTION 'Shadow attribution failed conservation or cardinality integrity check'; END IF;
  UPDATE mis_internal.shadow_attribution_runs SET status='completed',completed_at=now(),refresh_step='complete',
   source_last_date=v_max,invoice_count=v_invoices,patient_count=v_patients,encounter_count=v_encounters,appointment_count=v_appointments,
   net_bill_total=v_net,total_collected=v_collected,attributed_net_bill=v_attr,unattributed_net_bill=v_unattr,
   count_no_source=(SELECT count(*) FROM mis_internal.shadow_patient_acquisitions WHERE attribution_class='missing_source'),
   count_late_source=(SELECT count(*) FROM mis_internal.shadow_patient_acquisitions WHERE attribution_class='late_source'),
   count_unknown_source=(SELECT count(*) FROM mis_internal.shadow_patient_acquisitions WHERE attribution_class='unknown_source'),
   integrity_passed=true,findings=coalesce(findings,'{}'::jsonb)||jsonb_build_object('attribution_breakdown',mis_internal.marketing_coverage_metrics(),'source_coverage','historical_partial','clinical_invoice_based',true,'unknown_source_preserved',true,'revenue_balance',v_attr+v_unattr-v_net),
   error_details=NULL WHERE id=v_run;
  RETURN jsonb_build_object('status','completed','run_id',v_run,'invoices',v_invoices,'patients',v_patients,'encounters',v_encounters,
   'appointments',v_appointments,'net_bill',v_net,'attributed_net_bill',v_attr,'unattributed_net_bill',v_unattr,'balanced',v_good);
 ELSE
  RAISE EXCEPTION 'Unknown shadow attribution refresh step: %',v_step;
 END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.refresh_meta_phone_ad_outcomes(),public.refresh_meta_phone_ad_outcomes_detail(),public.refresh_meta_ad_outcome_daily_snapshot() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_meta_phone_ad_outcomes(),public.refresh_meta_phone_ad_outcomes_detail(),public.refresh_meta_ad_outcome_daily_snapshot() TO service_role;


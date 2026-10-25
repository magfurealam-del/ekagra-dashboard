-- Evidence-backed operational identity decisions are private, append-only,
-- and separate from source messages, patient identifiers and financial data.
CREATE TABLE mis_internal.marketing_evidence_resolution_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,run_id uuid NOT NULL,
 kind text NOT NULL,row_table text NOT NULL,row_id text NOT NULL,
 rule_version text NOT NULL,before_data jsonb NOT NULL,after_data jsonb NOT NULL,evidence jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK(jsonb_typeof(before_data)='object' AND jsonb_typeof(after_data)='object' AND jsonb_typeof(evidence)='object')
);
CREATE INDEX marketing_resolution_audit_run ON mis_internal.marketing_evidence_resolution_audit(run_id);
CREATE INDEX marketing_resolution_audit_subject ON mis_internal.marketing_evidence_resolution_audit(kind,row_id);
ALTER TABLE mis_internal.marketing_evidence_resolution_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.marketing_evidence_resolution_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON mis_internal.marketing_evidence_resolution_audit FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_marketing_resolution_audit BEFORE UPDATE OR DELETE ON mis_internal.marketing_evidence_resolution_audit
 FOR EACH ROW EXECUTE FUNCTION mis_internal.reject_marketing_observation_mutation();

-- A validated legacy-ID bridge can disambiguate an old CRM patient record
-- from its canonical MIS patient even when both retain the same phone.
-- Only explicitly audited repairs qualify, and the bridge must still be valid.
DO $view$
DECLARE prior text;
BEGIN
 prior:=rtrim(pg_get_viewdef('mis_internal.marketing_source_evidence_v2'::regclass,true),E';\n\r ');
 EXECUTE format($ddl$
 CREATE OR REPLACE VIEW mis_internal.marketing_source_evidence_v2 WITH(security_invoker=true) AS
 WITH previous_evidence AS (%s)
 SELECT * FROM previous_evidence
 UNION ALL
 SELECT c.patient_id,public.normalize_marketing_source(coalesce(nullif(c.lead_source,''),c.call_source)),c.log_date,
  'call_center_logs'::text,c.id::text,'original_call_log_date'::text,true,false,
  lower(coalesce(c.call_category,'')) LIKE '%%outgoing%%',95,1.0::numeric,c.ad_campaign,NULL::text,NULL::text,
  'audited_validated_legacy_patient_bridge'::text
 FROM public.call_center_logs c
 WHERE c.patient_id=c.matched_patient_id AND c.matched_method='validated_legacy_patient_bridge'
  AND EXISTS(SELECT 1 FROM mis_internal.marketing_evidence_resolution_audit a
   WHERE a.kind='validated_legacy_call_bridge' AND a.row_id=c.id::text
    AND (a.after_data->>'patient_id')::integer=c.patient_id
    AND EXISTS(SELECT 1 FROM public.patient_identity_keys k WHERE k.is_active AND k.is_validated AND NOT k.has_conflict
     AND k.key_type='crm_legacy_patient_id' AND k.key_value=a.evidence->>'legacy_patient_id' AND k.patient_id=c.patient_id)
    AND NOT EXISTS(SELECT 1 FROM public.patient_identity_keys k WHERE k.is_active AND k.is_validated AND NOT k.has_conflict
     AND k.key_type='crm_legacy_patient_id' AND k.key_value=a.evidence->>'legacy_patient_id' AND k.patient_id<>c.patient_id))
 $ddl$,prior);
END $view$;
REVOKE ALL ON mis_internal.marketing_source_evidence_v2 FROM PUBLIC,anon,authenticated;

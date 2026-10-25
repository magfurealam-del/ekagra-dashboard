-- Only selected, relevant source fields reach an authorized reviewer. Never
-- return raw webhook payloads, delivery headers or whole patient/CRM records.
CREATE FUNCTION mis_internal.marketing_review_original_records(p_actor_id uuid,p_patient_id bigint,p_page integer) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
 PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);
 IF p_page IS NULL OR p_page NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'Invalid review query' USING ERRCODE='22023'; END IF;
 WITH evidence AS (
  SELECT DISTINCT evidence_table,evidence_id FROM mis_internal.marketing_source_evidence_before_review WHERE patient_id=p_patient_id
 ), records AS (
  SELECT e.evidence_table,e.evidence_id,
   jsonb_strip_nulls(CASE e.evidence_table
    WHEN 'crm_leads' THEN jsonb_build_object('Name',l.lead_name,'Phone',l.phone,'Source',l.source,
     'Source system',l.source_system,'Original call record',l.external_lead_id,'CRM created at',l.created_at,
     'Direction',l.call_direction,'Notes',left(to_jsonb(l)->>'notes',4000))
    WHEN 'call_center_logs' THEN jsonb_build_object('Original call date',c.log_date,
     'Patient name',to_jsonb(c)->>'patient_name','Original hospital / legacy ID',c.patient_id_raw,
     'Phone',c.mobile_e164,'Source',c.lead_source,'Call source',c.call_source,'Category',c.call_category,
     'Comments',left(to_jsonb(c)->>'comments',4000),'Match method',c.matched_method)
    WHEN 'referral_patient_report' THEN jsonb_build_object('Hospital number',r.hospital_number,
     'Patient name',to_jsonb(r)->>'patient_name','Phone',to_jsonb(r)->>'phone_mobile',
     'Original registration date',r.reg_date,'Original MPO / referral label',r.mpo_name,
     'Source file',to_jsonb(r)->>'source_file','Source row',to_jsonb(r)->'source_row_number')
    WHEN 'lead_attribution' THEN jsonb_build_object('Lead ID',a.lead_id,'Call record',a.call_center_log_id,
     'Source',a.source_category,'Original first touch date',a.first_touch_date,'Attribution level',a.attribution_level,
     'Confidence',a.attribution_confidence,'Campaign',a.meta_campaign_name,'Ad',a.meta_ad_id,
     'Notes',left(to_jsonb(a)->>'notes',4000))
    WHEN 'messenger_attribution_touches' THEN jsonb_build_object('Original touch time',t.touched_at,
     'Touch type',t.touch_type,'Campaign',t.campaign_name,'Ad',t.ad_id,'Original webhook event',t.source_event_id)
    ELSE '{}'::jsonb END) fields
  FROM evidence e
  LEFT JOIN public.crm_leads l ON e.evidence_table='crm_leads' AND l.id::text=e.evidence_id
  LEFT JOIN public.call_center_logs c ON e.evidence_table='call_center_logs' AND c.id::text=e.evidence_id
  LEFT JOIN public.referral_patient_report r ON e.evidence_table='referral_patient_report' AND r.id::text=e.evidence_id
  LEFT JOIN public.lead_attribution a ON e.evidence_table='lead_attribution' AND a.id::text=e.evidence_id
  LEFT JOIN public.messenger_attribution_touches t ON e.evidence_table='messenger_attribution_touches' AND t.id::text=e.evidence_id
 )
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT * FROM records ORDER BY evidence_table,evidence_id LIMIT 100 OFFSET p_page*100)s),'[]'),
  'total',(SELECT count(*) FROM records)) INTO v_result;
 RETURN v_result;
END $$;
CREATE OR REPLACE FUNCTION public.marketing_review_read(p_actor_id uuid,p_kind text,p_id bigint DEFAULT NULL,
 p_page integer DEFAULT 0,p_filter text DEFAULT '',p_search text DEFAULT '') RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
 v_result:=mis_internal.marketing_review_read(p_actor_id,p_kind,p_id,p_page,p_filter,p_search);
 IF p_kind='revenue' AND p_id IS NOT NULL THEN
  v_result:=v_result||jsonb_build_object('originalRecords',mis_internal.marketing_review_original_records(p_actor_id,p_id,p_page));
 END IF;
 RETURN v_result;
END
$$;
REVOKE ALL ON FUNCTION mis_internal.marketing_review_original_records(uuid,bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mis_internal.marketing_review_original_records(uuid,bigint,integer) TO service_role;
REVOKE ALL ON FUNCTION public.marketing_review_read(uuid,text,bigint,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_review_read(uuid,text,bigint,integer,text,text) TO service_role;

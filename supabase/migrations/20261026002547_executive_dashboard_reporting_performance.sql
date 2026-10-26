-- Contact date belongs to the CRM contact, not to marketing source eligibility.
-- Read the original call date directly; avoid repeatedly expanding the identity
-- and marketing review evidence graph just to recover this date.
CREATE OR REPLACE VIEW mis_internal.executive_leads AS
 SELECT cl.*,coalesce(CASE WHEN cl.source_system='migrated_call_center_logs' THEN c.log_date END,
 (cl.created_at AT TIME ZONE 'Asia/Dhaka')::date) lead_date,
 CASE WHEN coalesce(nullif(la.source_category,''),nullif(cl.source,'')) ILIKE '%facebook%' THEN 'Facebook'
 ELSE initcap(coalesce(nullif(la.source_category,''),nullif(cl.source,''),'Unknown')) END source_name
 FROM public.crm_leads cl LEFT JOIN public.lead_attribution la ON la.lead_id=cl.id
 LEFT JOIN public.call_center_logs c ON cl.source_system='migrated_call_center_logs' AND c.id::text=cl.external_lead_id;
ALTER FUNCTION mis_internal.executive_overview(date,date) SET jit=off;
ALTER FUNCTION mis_internal.executive_sources(date,date) SET jit=off;
ALTER FUNCTION mis_internal.executive_agents(date,date) SET jit=off;
ALTER FUNCTION mis_internal.executive_ads(date,date) SET jit=off;
ALTER FUNCTION public.get_executive_dashboard(date,date,boolean) SET jit=off;


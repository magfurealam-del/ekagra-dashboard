-- Additive, aggregate-only reporting. Existing v2 remains available for rollback.
CREATE OR REPLACE FUNCTION mis_internal.decision_insights(p_start date,p_end date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET jit='off' AS $fn$
WITH
clock AS (SELECT (statement_timestamp() AT TIME ZONE 'Asia/Dhaka')::date today),
l AS MATERIALIZED (SELECT * FROM mis_internal.executive_leads WHERE lead_date BETWEEN p_start AND p_end),
a AS MATERIALIZED (SELECT * FROM mis_internal.executive_appointments),
pa AS MATERIALIZED (SELECT * FROM a WHERE appointment_date BETWEEN p_start AND p_end),
r AS MATERIALIZED (SELECT * FROM mis_internal.executive_revenue WHERE invoice_date BETWEEN p_start AND p_end),
q AS MATERIALIZED (SELECT *, (created_at AT TIME ZONE 'Asia/Dhaka')::date created_date FROM public.outgoing_call_queue WHERE status='open'),
ages AS (SELECT * FROM (VALUES (0,'0–7 days'),(1,'8–14 days'),(2,'15–30 days'),(3,'31+ days'),(4,'Unknown date')) t(rank,label)),
queue_age AS (SELECT CASE WHEN created_date IS NULL OR created_date>today THEN 4 WHEN today-created_date<=7 THEN 0 WHEN today-created_date<=14 THEN 1 WHEN today-created_date<=30 THEN 2 ELSE 3 END bucket,count(*) n FROM q CROSS JOIN clock GROUP BY 1),
quality_age AS (SELECT CASE WHEN today-appointment_date<=7 THEN 0 WHEN today-appointment_date<=14 THEN 1 WHEN today-appointment_date<=30 THEN 2 ELSE 3 END bucket,count(*) n FROM pa CROSS JOIN clock WHERE eligible AND NOT attended AND NOT explicit_no_show GROUP BY 1),
daily_revenue AS (SELECT invoice_date d,sum(revenue) revenue,count(*) invoices FROM r GROUP BY 1),
daily_visits AS (SELECT appointment_date d,count(*) FILTER(WHERE attended) verified,count(*) FILTER(WHERE eligible) eligible FROM pa GROUP BY 1),
first_visit AS MATERIALIZED (
 SELECT l.id,l.source_name,l.lead_date,min(a.appointment_date) FILTER(WHERE a.appointment_status NOT IN ('Cancelled','Rescheduled') AND a.appointment_date>=l.lead_date) first_date, min(a.appointment_date) FILTER(WHERE a.attended AND a.appointment_date>=l.lead_date) first_verified_date
 FROM l LEFT JOIN a ON a.lead_id=l.id GROUP BY l.id,l.source_name,l.lead_date
),
cohort_rows AS MATERIALIZED (
 SELECT h.horizon,l.id,l.source_name,la.meta_campaign_id campaign_id,coalesce(nullif(la.meta_campaign_name,''),la.meta_campaign_id) campaign_name,
 l.lead_date+h.horizon<=clock.today-2 mature,
 coalesce(f.first_date<=l.lead_date+h.horizon,false) scheduled,
 coalesce(f.first_verified_date<=l.lead_date+h.horizon,false) verified
 FROM l JOIN first_visit f ON f.id=l.id CROSS JOIN (VALUES(7),(14),(30)) h(horizon) CROSS JOIN clock
 LEFT JOIN LATERAL (SELECT meta_campaign_id,meta_campaign_name FROM public.lead_attribution WHERE lead_id=l.id ORDER BY created_at,id LIMIT 1) la ON true
),
source_cohorts AS (SELECT horizon,source_name,count(*) FILTER(WHERE mature) contacts,count(*) FILTER(WHERE NOT mature) immature,count(*) FILTER(WHERE mature AND scheduled) scheduled,count(*) FILTER(WHERE mature AND verified) verified FROM cohort_rows GROUP BY 1,2),
campaign_cohorts AS (SELECT horizon,campaign_id,max(campaign_name) name,count(*) FILTER(WHERE mature) contacts,count(*) FILTER(WHERE NOT mature) immature,count(*) FILTER(WHERE mature AND scheduled) scheduled,count(*) FILTER(WHERE mature AND verified) verified FROM cohort_rows WHERE campaign_id IS NOT NULL GROUP BY 1,2),
cohort_totals AS (SELECT h.horizon,count(c.id) FILTER(WHERE mature) contacts,count(c.id) FILTER(WHERE NOT mature) immature,count(c.id) FILTER(WHERE mature AND scheduled) scheduled,count(c.id) FILTER(WHERE mature AND verified) verified FROM (VALUES(7),(14),(30))h(horizon) LEFT JOIN cohort_rows c USING(horizon) GROUP BY 1),
delays AS (SELECT source_name,count(*) contacts,count(first_date) scheduled,percentile_cont(0.5) WITHIN GROUP(ORDER BY first_date-lead_date) median_days,percentile_cont(0.75) WITHIN GROUP(ORDER BY first_date-lead_date) p75_days FROM first_visit GROUP BY 1),
ad_eligible AS (SELECT la.meta_campaign_id campaign_id,la.meta_ad_id ad_id,count(*) FILTER(WHERE pa.eligible) eligible,count(*) FILTER(WHERE pa.eligible AND NOT pa.attended AND NOT pa.explicit_no_show) unresolved FROM pa JOIN public.lead_attribution la ON la.lead_id=pa.lead_id WHERE la.meta_campaign_id IS NOT NULL GROUP BY 1,2)
SELECT jsonb_build_object(
 'daily',coalesce((SELECT jsonb_agg(jsonb_build_object('date',g.day::date,'revenue',coalesce(dr.revenue,0),'invoices',coalesce(dr.invoices,0),'verified',CASE WHEN g.day::date<=clock.today-2 THEN coalesce(dv.verified,0) END,'eligible',CASE WHEN g.day::date<=clock.today-2 THEN coalesce(dv.eligible,0) END) ORDER BY g.day) FROM generate_series(p_start::timestamp,p_end::timestamp,interval '1 day')g(day) CROSS JOIN clock LEFT JOIN daily_revenue dr ON dr.d=g.day::date LEFT JOIN daily_visits dv ON dv.d=g.day::date),'[]'::jsonb),
 'cohorts',(SELECT jsonb_agg(jsonb_build_object('horizon',ct.horizon,'contacts',ct.contacts,'immature',ct.immature,'scheduled',ct.scheduled,'verified',ct.verified,
 'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('name',source_name,'contacts',contacts,'immature',immature,'scheduled',scheduled,'verified',verified) ORDER BY contacts DESC,source_name) FROM source_cohorts sc WHERE sc.horizon=ct.horizon),'[]'::jsonb),
 'campaigns',coalesce((SELECT jsonb_agg(jsonb_build_object('id',campaign_id,'name',name,'contacts',contacts,'immature',immature,'scheduled',scheduled,'verified',verified) ORDER BY contacts DESC,campaign_id) FROM campaign_cohorts cc WHERE cc.horizon=ct.horizon),'[]'::jsonb)) ORDER BY ct.horizon) FROM cohort_totals ct),
 'delays',coalesce((SELECT jsonb_agg(jsonb_build_object('name',source_name,'contacts',contacts,'scheduled',scheduled,'median_days',median_days,'p75_days',p75_days) ORDER BY contacts DESC,source_name) FROM delays),'[]'::jsonb),
 'queue',jsonb_build_object('total',(SELECT count(*) FROM q),'age',(SELECT jsonb_agg(jsonb_build_object('label',ages.label,'count',coalesce(qa.n,0)) ORDER BY ages.rank) FROM ages LEFT JOIN queue_age qa ON qa.bucket=ages.rank),
 'categories',coalesce((SELECT jsonb_agg(jsonb_build_object('label',category,'count',n) ORDER BY n DESC,category) FROM (SELECT coalesce(nullif(category,''),'Unknown') category,count(*) n FROM q GROUP BY 1)t),'[]'::jsonb)),
 'attempt_outcomes',coalesce((SELECT jsonb_agg(jsonb_build_object('label',label,'count',n) ORDER BY n DESC,label) FROM (SELECT coalesce(nullif(outcome_code,''),'Unspecified') label,count(*) n FROM public.outgoing_call_attempts WHERE (called_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN p_start AND p_end AND status<>'pending' GROUP BY 1)t),'[]'::jsonb),
 'quality',jsonb_build_object('age',(SELECT jsonb_agg(jsonb_build_object('label',ages.label,'count',coalesce(qa.n,0)) ORDER BY ages.rank) FROM ages LEFT JOIN quality_age qa ON qa.bucket=ages.rank WHERE ages.rank<4),
 'reasons',coalesce((SELECT jsonb_agg(jsonb_build_object('label',label,'count',n) ORDER BY n DESC,label) FROM (SELECT CASE WHEN evidence_conflict THEN 'Conflicting invoice evidence' WHEN appointment_status='Completed' THEN 'Completed without qualifying evidence' WHEN appointment_status='No-show' THEN 'No-show with conflicting visit evidence' ELSE 'Outcome not finalized' END label,count(*) n FROM pa WHERE eligible AND NOT attended AND NOT explicit_no_show GROUP BY 1)t),'[]'::jsonb)),
 'attribution',jsonb_build_object('known_source',(SELECT count(*) FROM l WHERE source_name<>'Unknown'),'unknown_source',(SELECT count(*) FROM l WHERE source_name='Unknown'),
 'review_reasons',coalesce((SELECT jsonb_agg(jsonb_build_object('label',match_status,'count',n) ORDER BY n DESC,match_status) FROM (SELECT match_status,count(*) n FROM public.crm_invoice_reconciliation WHERE invoice_date BETWEEN p_start AND p_end AND match_status LIKE 'needs_review%' GROUP BY 1)t),'[]'::jsonb),
 'fields',jsonb_build_array(jsonb_build_object('label','Source recorded','count',(SELECT count(*) FROM l WHERE source_name<>'Unknown')),
 jsonb_build_object('label','Patient type recorded','count',(SELECT count(*) FROM l WHERE public.call_kpi_patient_type_label(patient_type) IN('New','Old'))),
 jsonb_build_object('label','Agent recorded','count',(SELECT count(*) FROM l WHERE nullif(trim(agent_name),'') IS NOT NULL)))),
 'ad_eligible',coalesce((SELECT jsonb_agg(to_jsonb(ad_eligible)) FROM ad_eligible),'[]'::jsonb)
);
$fn$;

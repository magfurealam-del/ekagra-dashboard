import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
const root=new URL('../',import.meta.url)
const db=new PGlite()
const value=async(sql,params=[]) => (await db.query(sql,params)).rows[0]
try {
 await db.exec(`CREATE SCHEMA auth;CREATE SCHEMA mis_internal;CREATE ROLE anon;CREATE ROLE authenticated;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT '00000000-0000-0000-0000-000000000001'::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
 CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$SELECT coalesce(current_setting('test.admin',true),'false')='true'$$;
 CREATE FUNCTION public.is_active_staff() RETURNS boolean LANGUAGE sql AS $$SELECT coalesce(current_setting('test.staff',true),'true')='true'$$;
 CREATE FUNCTION public.call_kpi_incoming_outcome_label(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT coalesce($1,'Unspecified')$$;
 CREATE FUNCTION public.call_kpi_lead_source_label(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT coalesce($1,'Unknown')$$;
 CREATE FUNCTION public.call_kpi_queue_category_label(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT coalesce($1,'Unknown')$$;
 CREATE FUNCTION public.call_kpi_patient_type_label(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT CASE lower($1) WHEN 'new' THEN 'New' WHEN 'old' THEN 'Old' ELSE 'Unknown' END$$;
 CREATE FUNCTION mis_internal.gateway_publication_blocked() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 SET test.admin='true';SET request.jwt.claim.role='authenticated';`)
 await db.exec(await readFile(new URL('scripts/dashboard-test-schema.sql',root),'utf8'))
 await db.exec(`CREATE VIEW mis_internal.strict_appointment_attendance AS SELECT a.id appointment_id,
 coalesce(a.visit_verified,false) AND i.patient_id=a.patient_id AND i.invoice_date=a.appointment_date
 AND coalesce(i.net_bill,0)>0 AND i.invoice_status NOT IN ('void','cancelled')
 AND lower(i.consultant_name_raw)=lower(a.doctor_service) strict_attendance_verified
 FROM public.crm_appointments a LEFT JOIN public.invoices i ON i.id=a.matched_invoice_id;
 INSERT INTO public.user_profiles(id,role,is_active) VALUES(auth.uid(),'admin',true);
 INSERT INTO mis_internal.mis_gateway_publication(singleton,stage,updated_at) VALUES(true,'complete',now());`)
 await db.exec(await readFile(new URL('supabase/migrations/20261026002346_executive_dashboard_reporting_contract.sql',root),'utf8'))
 await db.exec('CREATE TABLE public.call_center_logs(id bigint,log_date date)')
 await db.exec(await readFile(new URL('supabase/migrations/20261026002547_executive_dashboard_reporting_performance.sql',root),'utf8'))
 await db.exec(await readFile(new URL('supabase/migrations/20261026002802_executive_dashboard_materialized_read.sql',root),'utf8'))
 await db.exec(await readFile(new URL('supabase/migrations/20261026010725_decision_dashboard_insights.sql',root),'utf8'))
 await db.exec(await readFile(new URL('supabase/migrations/20261026010912_decision_cohort_single_pass.sql',root),'utf8'))
 await db.exec(await readFile(new URL('supabase/migrations/20261026104511_dashboard_audit_call_consistency.sql',root),'utf8'))
 const decisions=async(start='2020-10-01',end='2020-10-25')=>(await value('SELECT public.get_decision_dashboard($1,$2,false) r',[start,end])).r
 let decision=await decisions();assert.equal(decision.contract_version,3);assert.equal(decision.insights.queue.total,0);assert.equal(decision.insights.daily.length,25);assert.equal(decision.insights.cohorts[0].contacts,0)
 const report=async(start='2020-10-01',end='2020-10-25',compare=true)=>(await value('SELECT public.get_executive_dashboard($1,$2,$3) r',[start,end,compare])).r
 let r=await report();assert.equal(r.metrics.total_leads,0);assert.equal(r.metrics.show_rate,null);assert.deepEqual(r.sources.sources,[])
 await db.exec(`INSERT INTO public.crm_leads(id,patient_id,source,patient_type,agent_name,created_at,lead_status)
 VALUES(1,1,'facebook','New','A','2020-09-30T18:00:00Z','appointment_done'),
 (2,2,'hotline','Old',null,'2020-10-25T18:00:00Z','appointment_booked'),
 (3,3,'hotline',null,'B','2020-11-01T10:00:00Z','callback_scheduled');
 UPDATE public.crm_leads SET call_direction='Incoming' WHERE id IN (1,2,3);
 INSERT INTO public.call_center_logs(id,log_date) VALUES(100,'2020-10-01'); UPDATE public.crm_leads SET source_system='migrated_call_center_logs',external_lead_id='100' WHERE id=3;
 INSERT INTO public.patients(id,patient_type) VALUES(1,'New'),(2,'Old'),(3,'Unknown');
 INSERT INTO public.invoices(id,patient_id,invoice_date,net_bill,invoice_status,reconciliation_status,consultant_name_raw)
 VALUES(1,1,'2020-10-02',100,'paid','matched','Doctor'),(2,2,'2020-10-02',0,'paid','matched','Doctor'),
 (3,3,'2020-10-03',300,'paid','matched','Doctor'),(4,1,'2020-10-02',200,'void','matched','Doctor');
 INSERT INTO public.crm_appointments(id,patient_id,lead_id,appointment_date,appointment_status,doctor_service,visit_verified,matched_invoice_id)
 VALUES(1,1,1,'2020-10-02','Completed','Doctor',true,1),
 (2,2,2,'2020-10-02','Completed','Doctor',true,2),
 (3,3,3,'2020-10-02','Completed','Doctor',true,3),
 (4,2,2,'2020-10-02','No-show','Doctor',false,null),
 (5,1,1,'2020-10-02','Cancelled','Doctor',true,1),
 (6,1,1,'2020-10-02','Rescheduled','Doctor',true,1);
 INSERT INTO public.crm_billing_links(source_table,source_record_id,patient_id,invoice_id,invoice_date,attributed_revenue)
 VALUES('crm_leads','1',1,1,'2020-10-02',100),('crm_leads','1',1,1,'2020-10-02',100),('crm_leads','1',1,4,'2020-10-02',200);`)
 r=await report()
 assert.equal(r.metrics.total_leads,2,'Bangladesh midnight and original contact dates')
 assert.equal(r.sources.sources.reduce((n,s)=>n+s.leads,0),2)
 assert.equal(r.agents.agents.reduce((n,a)=>n+a.incoming+a.outgoing_leads,0),2)
 assert.equal(r.metrics.booked_leads,1,'status spelling normalized')
 assert.equal(r.metrics.total_revenue,100,'duplicate links collapsed; void excluded')
 assert.equal(r.metrics.attendance.eligible,4)
 assert.equal(r.metrics.mis_verified_attended,1)
 assert.equal(r.metrics.explicit_crm_no_shows,1)
 assert.equal(r.metrics.attendance.unresolved,2,'no-charge and off-date evidence remain unresolved')
 assert.equal(r.metrics.show_rate,25)
 assert.equal(r.sources.sources.reduce((n,s)=>n+s.new_attended+s.old_attended,0),1)
 assert.equal(r.sources.sources.reduce((n,s)=>n+s.appointments_eligible,0),4)
 assert.equal(r.metrics.attendance.eligible,r.metrics.attendance.verified+r.metrics.attendance.explicit_no_show+r.metrics.attendance.unresolved)
 assert.equal(r.metrics.total_appointments,r.metrics.attendance.eligible+r.metrics.attendance.excluded+r.metrics.attendance.awaiting_maturity)
 assert.equal(r.metrics.lead_cohort.with_verified_visit,1)
 decision=await decisions()
 assert.equal(decision.insights.daily.reduce((s,d)=>s+d.revenue,0),r.metrics.total_revenue)
 assert.equal(decision.insights.daily.reduce((s,d)=>s+(d.verified??0),0),r.metrics.mis_verified_attended)
 assert.equal(decision.insights.quality.reasons.reduce((s,d)=>s+d.count,0),r.metrics.attendance.unresolved)
 assert.equal(decision.insights.quality.age.reduce((s,d)=>s+d.count,0),r.metrics.attendance.unresolved)
 assert.equal(decision.insights.cohorts[1].contacts,2)
 assert.equal(decision.insights.cohorts[1].scheduled,2)
 assert.equal(decision.insights.cohorts[1].verified,1)
 assert.equal(decision.insights.cohorts[1].sources.reduce((s,d)=>s+d.contacts,0),2)
 assert.equal(r.previous.period_end,'2020-09-30')
 assert.equal((await report('2020-10-01','2020-10-25',false)).previous,null)
 // Reusing a verified invoice creates unresolved duplicates, not double attendance.
 await db.exec(`INSERT INTO public.crm_appointments(id,patient_id,lead_id,appointment_date,appointment_status,doctor_service,visit_verified,matched_invoice_id)
 VALUES(7,1,1,'2020-10-02','Completed','Doctor',true,1);`)
 r=await report();assert.equal(r.metrics.mis_verified_attended,0);assert.equal(r.metrics.show_rate,0)
 // Same day, yesterday and future are outside the mature reporting cohort.
 await db.exec(`INSERT INTO public.crm_appointments(id,patient_id,appointment_date,appointment_status)
 SELECT 20+d,1,(now() AT TIME ZONE 'Asia/Dhaka')::date+d,'No-show' FROM generate_series(-1,1)d;`)
 const today=(await value("SELECT (now() AT TIME ZONE 'Asia/Dhaka')::date::text d")).d
 const end=(await value("SELECT ((now() AT TIME ZONE 'Asia/Dhaka')::date+1)::text d")).d
 const start=(await value("SELECT ((now() AT TIME ZONE 'Asia/Dhaka')::date-1)::text d")).d
 r=await report(start,end);assert.equal(r.metrics.attendance.awaiting_maturity,3);assert.equal(r.metrics.attendance.eligible,0);assert.equal(r.metrics.show_rate,null)
 await assert.rejects(report('2020-10-02','2020-10-01'),/valid reporting period/)
 await assert.rejects(report('2020-01-01','2022-01-01'),/366 days/)
 // Fixed observation horizons include the boundary, exclude immature contacts,
 // and ignore scheduled visits before contact or after the chosen horizon.
 await db.exec(`INSERT INTO public.crm_leads(id,source,created_at) VALUES
 (101,'Boundary',(now() AT TIME ZONE 'Asia/Dhaka')::date-16),
 (102,'Immature',(now() AT TIME ZONE 'Asia/Dhaka')::date-15),
 (103,'Late',(now() AT TIME ZONE 'Asia/Dhaka')::date-40);
 INSERT INTO public.crm_appointments(id,lead_id,appointment_date,appointment_status) VALUES
 (101,101,(now() AT TIME ZONE 'Asia/Dhaka')::date-2,'Booked'),
 (103,103,(now() AT TIME ZONE 'Asia/Dhaka')::date-25,'Booked');
 INSERT INTO public.outgoing_call_queue(id,status,category,created_at) VALUES
 (1,'open','test',now()-interval '3 days'),(2,'open','test',now()-interval '20 days'),
 (3,'closed','test',now()),(4,'open','test',null);`)
 const recentStart=(await value("SELECT ((now() AT TIME ZONE 'Asia/Dhaka')::date-40)::text d")).d
 decision=await decisions(recentStart,today)
 const c14=decision.insights.cohorts.find(c=>c.horizon===14)
 assert.equal(c14.contacts,2);assert.equal(c14.immature,1);assert.equal(c14.scheduled,1)
 assert.equal(decision.insights.cohorts.find(c=>c.horizon===30).scheduled,1)
 assert.equal(decision.insights.queue.total,3)
 assert.equal(decision.insights.queue.age.reduce((s,d)=>s+d.count,0),3)
 assert.equal(decision.insights.queue.age.find(d=>d.label==='Unknown date').count,1)
 assert.equal(decision.insights.daily.at(-1).verified,null,'immature visit dates are not zeros')
 await assert.rejects(decisions('2020-10-02','2020-10-01'),/valid reporting period/)
 await assert.rejects(decisions('2020-01-01','2022-01-01'),/366 days/)
 // Call reports share clinic date boundaries and original migrated contact dates.
 // Unspecified direction is not an incoming call; unassigned real calls remain counted.
 await db.exec(`INSERT INTO public.crm_leads(id,created_at,call_direction,agent_name,source_system,external_lead_id) VALUES
 (1001,'2018-12-31T18:00:00Z','Incoming','Test Agent',null,null),
 (1002,'2019-01-01T17:59:59Z','Outgoing',null,null,null),
 (1003,'2019-01-01T18:00:00Z','Incoming','Test Agent',null,null),
 (1004,'2019-01-01T05:00:00Z',null,null,'website',null),
 (1005,'2019-01-05T12:00:00Z','Incoming','Test Agent','migrated_call_center_logs','999'),
 (1006,'2019-01-01T05:00:00Z','  ',null,'website',null);
 INSERT INTO public.call_center_logs VALUES(999,'2019-01-01');
 INSERT INTO public.outgoing_call_queue(id) VALUES(1001);
 INSERT INTO public.outgoing_call_attempts(id,queue_id,called_at,status,assigned_agent,outcome_code) VALUES(1001,1001,'2018-12-31T18:01:00Z','completed',null,'reached');
 INSERT INTO public.appointment_confirmation_calls(id,called_at,agent_name,outcome) VALUES(1001,'2018-12-31T18:05:00Z',null,'confirmed'),(1002,'2019-01-01T18:00:00Z',null,'confirmed');`)
 for (const timezone of ['UTC','America/New_York','Asia/Dhaka']) {
  await db.exec(`SET timezone='${timezone}'`)
  const calls=(await value("SELECT public.get_call_center_kpis_fast('2019-01-01','2019-01-01') r")).r
  assert.equal(calls.incoming_total,2);assert.equal(calls.outgoing_leads_total,1);assert.equal(calls.outbound_total,1);assert.equal(calls.confirmation_total,1)
  for (const key of ['incoming','outgoing_leads','outbound','confirmation']) {
   assert.equal(calls.daily_trend.reduce((s,r)=>s+r[key],0),calls[`${key}_total`])
   assert.equal(calls.by_agent.reduce((s,r)=>s+r[key],0),calls[`${key}_total`])
  }
  assert.equal(calls.call_log.length,5)
  assert.equal(calls.call_log.filter(r=>r.details?.date_basis==='Original contact date; time unavailable').length,1)
  assert.equal(calls.by_agent.find(a=>a.agent==='Unassigned').confirmation,1)
  const executive=await report('2019-01-01','2019-01-01',false)
  assert.equal(executive.agents.agents.reduce((s,a)=>s+a.incoming+a.outgoing_leads+a.outbound+a.confirmation,0),5)
 }
 await assert.rejects(value("SELECT public.get_call_center_kpis_fast('2019-01-02','2019-01-01')"),/valid reporting period/)
 await db.exec("SET test.staff='false'")
 await assert.rejects(value("SELECT public.get_call_center_kpis_fast('2019-01-01','2019-01-01')"),/Active staff access required/)
 assert.equal((await value("SELECT has_function_privilege('anon','public.get_call_center_kpis_fast(date,date)','EXECUTE') allowed")).allowed,false)
 await db.exec("SET test.admin='false'")
 await assert.rejects(report(),/Admin access required/)
 await assert.rejects(decisions(),/Admin access required/)
 assert.equal((await value("SELECT has_function_privilege('anon','public.get_decision_dashboard(date,date,boolean)','EXECUTE') allowed")).allowed,false)
 assert.equal((await value("SELECT has_function_privilege('authenticated','mis_internal.decision_insights(date,date)','EXECUTE') allowed")).allowed,false)
 assert.equal((await value("SELECT has_function_privilege('anon','public.get_executive_dashboard(date,date,boolean)','EXECUTE') allowed")).allowed,false)
 assert.equal((await value("SELECT has_table_privilege('authenticated','mis_internal.executive_leads','SELECT') allowed")).allowed,false)
 console.log('Dashboard SQL contract passed: dates, cross-section totals, rate denominator, evidence, duplicates, empty/zero, comparison, range bounds, and access controls.')
} catch(error) { console.error(error.message, error.detail ?? '', error.position ?? '', error.stack?.split('\n').slice(1,3).join('\n')); process.exitCode=1 } finally {await db.close()}

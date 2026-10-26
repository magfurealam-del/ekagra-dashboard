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
 const report=async(start='2020-10-01',end='2020-10-25',compare=true)=>(await value('SELECT public.get_executive_dashboard($1,$2,$3) r',[start,end,compare])).r
 let r=await report();assert.equal(r.metrics.total_leads,0);assert.equal(r.metrics.show_rate,null);assert.deepEqual(r.sources.sources,[])
 await db.exec(`INSERT INTO public.crm_leads(id,patient_id,source,patient_type,agent_name,created_at,lead_status)
 VALUES(1,1,'facebook','New','A','2020-09-30T18:00:00Z','appointment_done'),
 (2,2,'hotline','Old',null,'2020-10-25T18:00:00Z','appointment_booked'),
 (3,3,'hotline',null,'B','2020-11-01T10:00:00Z','callback_scheduled');
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
 await db.exec("SET test.admin='false'")
 await assert.rejects(report(),/Admin access required/)
 assert.equal((await value("SELECT has_function_privilege('anon','public.get_executive_dashboard(date,date,boolean)','EXECUTE') allowed")).allowed,false)
 assert.equal((await value("SELECT has_table_privilege('authenticated','mis_internal.executive_leads','SELECT') allowed")).allowed,false)
 console.log('Dashboard SQL contract passed: dates, cross-section totals, rate denominator, evidence, duplicates, empty/zero, comparison, range bounds, and access controls.')
} finally {await db.close()}


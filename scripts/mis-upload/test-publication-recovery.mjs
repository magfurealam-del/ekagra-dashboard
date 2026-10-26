import { readFile, readdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
const root=new URL('../../',import.meta.url)
const read=p=>readFile(new URL(p,root),'utf8')
const db=new PGlite()
const one=async sql=>(await db.query(sql)).rows[0]
try {
 await db.exec("CREATE SCHEMA mis_internal; CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; SET check_function_bodies=off; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('test.role',true)$$; CREATE FUNCTION mis_internal.is_overnight() RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('test.night',true)='on'$$; SET test.role='service_role'; SET test.night='off';")
 await db.exec(await read('scripts/mis-upload/publication-test-schema.sql'))
 await db.exec(await read('scripts/mis-upload/marketing-test-schema.sql'))
 await db.exec("ALTER TABLE public.invoices ADD patient_type text,ADD admission_id integer,ADD an text,ADD consultant_name_raw text,ADD total_collected numeric DEFAULT 0; ALTER TABLE public.crm_appointments ADD appointment_date date,ADD appointment_status text,ADD doctor_service text; ALTER TABLE public.patient_marketing_attribution ADD attribution_status text; ALTER TABLE mis_internal.shadow_invoice_evidence ADD PRIMARY KEY(invoice_id); CREATE TABLE public.dashboard_metric_snapshots(snapshot_key text,start_date date,end_date date);")
 const source=await read('supabase/migrations/20261025002551_mis_upload_marketing_reconciliation.sql')
 const start=source.indexOf('CREATE OR REPLACE FUNCTION mis_internal.mis_gateway_tick()')
 const end=source.indexOf("REVOKE ALL ON FUNCTION public.refresh_meta_phone_ad_outcomes()",start)
 let implementation=source.slice(start,end).replace("pub.published_batch_id>=target AND pub.rules_version=","pub.stage='complete' AND pub.published_batch_id>=target AND pub.rules_version=")
 await db.exec(implementation)
 await db.exec("CREATE FUNCTION public.mis_gateway_tick() RETURNS jsonb LANGUAGE sql AS $$SELECT mis_internal.mis_gateway_tick()$$; CREATE FUNCTION mis_internal.gateway_publication_blocked() RETURNS boolean LANGUAGE sql AS $$SELECT false$$; CREATE FUNCTION mis_internal.doctor_match_key(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT nullif($1,'')$$; CREATE FUNCTION mis_internal.marketing_coverage_metrics() RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$; CREATE FUNCTION public.refresh_meta_phone_ad_outcomes() RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$; CREATE FUNCTION mis_internal.refresh_crm_contact_history_v2() RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF NOT mis_internal.is_overnight() THEN RETURN jsonb_build_object('status','outside_overnight_window'); END IF; RETURN jsonb_build_object('status','completed'); END$$; CREATE FUNCTION mis_internal.refresh_gateway_marketing_attribution(bigint,integer) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF NOT mis_internal.is_overnight() THEN RETURN jsonb_build_object('status','outside_overnight_window'); END IF; RETURN jsonb_build_object('status','completed','source_revision',1); END$$;")
 const file=(await readdir(new URL('supabase/migrations/',root))).find(f=>f.endsWith('_repair_reconciliation_publication_recovery.sql'))
 await db.exec(await read('supabase/migrations/'+file))
 await db.exec("INSERT INTO mis_internal.mis_gateway_batches(id) VALUES(1); INSERT INTO mis_internal.marketing_reconciliation_state VALUES(true,1); INSERT INTO mis_internal.mis_gateway_publication(singleton,target_batch_id,published_batch_id,stage,snapshot_after,rules_version,marketing_revision) VALUES(true,1,1,'lifetime','','marketing_pipeline_v2',1); INSERT INTO mis_internal.shadow_attribution_runs(id,status,refresh_step,source_last_date,findings) VALUES(1,'running','evidence','2026-06-01','{\"history_start\":\"2026-06-01\"}'); INSERT INTO public.invoices(id,patient_id,invoice_date,net_bill,total_collected,consultant_name_raw) SELECT n,n,'2026-06-01',100,90,'Synthetic Doctor' FROM generate_series(1,1001)n; INSERT INTO public.invoice_line_items(invoice_id,particulars) SELECT id,'Consultation' FROM public.invoices; UPDATE public.invoices SET invoice_type='refund' WHERE id=2; INSERT INTO public.patient_marketing_attribution(patient_id,attribution_status,first_touch_source,first_touch_date) SELECT id,'eligible_source','Synthetic source','2026-05-01' FROM public.invoices; INSERT INTO public.crm_appointments(id,patient_id,appointment_date,appointment_status,doctor_service) VALUES(1,1,'2026-06-01','Booked','Synthetic Doctor');")
 const tick=async()=> (await one('SELECT public.mis_gateway_tick() r')).r
 // Anonymous callers are still rejected even when a publication is stalled.
 await db.exec("SET test.role='anon'")
 await assert.rejects(tick(),/service role required/)
 await db.exec("SET test.role='service_role'")
 // New source jobs and an idle publication cannot start during daytime.
 await db.exec("INSERT INTO mis_internal.mis_gateway_jobs(status) VALUES('pending')")
 assert.equal((await tick()).status,'outside_overnight_window')
 await db.exec("DELETE FROM mis_internal.mis_gateway_jobs")
 // Standalone legacy calls cannot obtain the daytime publication exemption.
 assert.equal((await one('SELECT mis_internal.refresh_shadow_lifetime_attribution() r')).r.status,'outside_overnight_window')
 assert.equal((await tick()).status,'advanced')
 assert.equal((await one('SELECT count(*)::int n FROM mis_internal.shadow_invoice_evidence')).n,500)
 assert.equal((await one('SELECT refresh_step FROM mis_internal.shadow_attribution_runs')).refresh_step,'evidence')
 // Simulate failure halfway through a page: both rows and cursor must roll back.
 await db.exec("CREATE FUNCTION mis_internal.fail_test_row() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.invoice_id=750 THEN RAISE EXCEPTION 'synthetic interrupted page'; END IF; RETURN NEW; END$$; CREATE TRIGGER fail_page BEFORE INSERT ON mis_internal.shadow_invoice_evidence FOR EACH ROW EXECUTE FUNCTION mis_internal.fail_test_row();")
 assert.equal((await tick()).status,'deferred')
 assert.equal((await one('SELECT count(*)::int n FROM mis_internal.shadow_invoice_evidence')).n,500)
 assert.equal((await one("SELECT (findings->>'evidence_after')::int cursor FROM mis_internal.shadow_attribution_runs")).cursor,500)
 await db.exec('DROP TRIGGER fail_page ON mis_internal.shadow_invoice_evidence')
 await tick()
 assert.equal((await one('SELECT count(*)::int n FROM mis_internal.shadow_invoice_evidence')).n,1000)
 await tick()
 assert.equal((await one('SELECT count(*)::int n FROM mis_internal.shadow_invoice_evidence')).n,1001)
 assert.equal((await one('SELECT refresh_step FROM mis_internal.shadow_attribution_runs')).refresh_step,'encounters')
 assert.equal((await one('SELECT clinical_line_evidence FROM mis_internal.shadow_invoice_evidence WHERE invoice_id=2')).clinical_line_evidence,false)
 for(let i=0;i<12;i++) {await tick();if((await one('SELECT stage FROM mis_internal.mis_gateway_publication')).stage==='complete')break}
 assert.equal((await one('SELECT stage FROM mis_internal.mis_gateway_publication')).stage,'complete')
 assert.equal((await one('SELECT integrity_passed FROM mis_internal.shadow_attribution_runs')).integrity_passed,true)
 assert.equal(Number((await one('SELECT sum(net_bill) n FROM mis_internal.shadow_invoice_attribution')).n),100100)
 assert.equal((await tick()).status,'outside_overnight_window')
 assert.equal((await one("SELECT has_function_privilege('authenticated','mis_internal.is_publication_window()','EXECUTE') allowed")).allowed,false)
 assert.ok((await one("SELECT proconfig FROM pg_proc WHERE oid='public.mis_gateway_tick()'::regprocedure")).proconfig.includes('statement_timeout=55s'))
 console.log('Publication recovery passed: bounded pages, transaction rollback, restart, refunds, conserved revenue, daytime guards, permissions and completed publication.')
} finally {await db.close()}


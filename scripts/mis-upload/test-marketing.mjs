import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto'
const root=new URL('../../',import.meta.url)
const db=new PGlite({extensions:{pgcrypto}})
const scalar=async(sql,params=[]) => (await db.query(sql,params)).rows[0]
let tests=0
try {
 await db.exec(`CREATE SCHEMA mis_internal; CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
 SET request.jwt.claim.role='service_role';
 CREATE FUNCTION public.normalize_hospital_identifier(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT upper(regexp_replace($1,'[^a-zA-Z0-9]','','g')) $$;
 CREATE FUNCTION public.normalize_marketing_source(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(lower(btrim($1)),'') $$;
 CREATE TABLE mis_internal.mis_gateway_batches(id bigint PRIMARY KEY);`)
 await db.exec(await readFile(new URL('scripts/mis-upload/marketing-test-schema.sql',root),'utf8'))
 const migration=await readFile(new URL('supabase/migrations/20261025002551_mis_upload_marketing_reconciliation.sql',root),'utf8')
 await db.exec(migration.slice(0,migration.indexOf('CREATE FUNCTION mis_internal.refresh_gateway_marketing_attribution')))
 await db.exec(await readFile(new URL('supabase/migrations/20261025002604_marketing_spend_sync_gateway.sql',root),'utf8'))
 const rebuild=async(...ids)=>db.query('SELECT mis_internal.rebuild_marketing_patients($1)',[ids])
 await db.exec(`INSERT INTO public.patients(id,hn,phone_e164) VALUES(1,'H1','+8801700000001'),(2,'H2','+8801700000002'),(3,'H3','+8801700000003'),(4,'H4','+8801700000004'),(5,'H5','+8801700000005');
 INSERT INTO public.invoices(id,patient_id,invoice_date,net_bill) VALUES(1,1,'2026-06-01',100),(2,2,'2026-06-01',200),(3,3,'2026-06-01',300),(4,4,'2026-06-01',400),(5,5,'2026-06-01',500);
 INSERT INTO public.invoice_line_items(invoice_id,particulars) SELECT id,'Consultation' FROM public.invoices;`)
 // Migrated events retain their original call date, not the later import date.
 await db.exec(`INSERT INTO public.call_center_logs(id,patient_id,matched_patient_id,patient_id_raw,log_date,lead_source,matched_confidence) VALUES(1,1,1,'H1','2026-05-01','facebook',1);
 INSERT INTO public.crm_leads(patient_id,source,source_system,external_lead_id,created_at) VALUES(1,'facebook','migrated_call_center_logs','1','2026-07-01');`)
 await rebuild(1)
 let r=await scalar('SELECT * FROM public.patient_marketing_attribution WHERE patient_id=1')
 assert.equal(new Date(r.first_touch_date).toISOString().slice(0,10),'2026-05-01');assert.equal(r.attribution_status,'eligible_source');tests++
 // Strong identity evidence cannot remain authenticated after a conflict.
 await db.exec('UPDATE public.call_center_logs SET matched_patient_id=2 WHERE id=1')
 await rebuild(1)
 r=await scalar('SELECT * FROM public.patient_marketing_attribution WHERE patient_id=1')
 assert.equal(r.is_authenticated,false);assert.notEqual(r.attribution_status,'eligible_source');assert.equal(r.validated_source,null);tests++
 // Unknown earlier contacts do not suppress later eligible, original evidence.
 await db.exec(`INSERT INTO public.crm_leads(patient_id,source,created_at) VALUES(2,'unknown','2026-04-01'),(2,'facebook','2026-05-01');`)
 await rebuild(2)
 assert.equal((await scalar('SELECT attribution_status,first_touch_source FROM public.patient_marketing_attribution WHERE patient_id=2')).first_touch_source,'facebook');tests++
 // Equal-strength, same-day sources remain conflicted rather than using an ID.
 await db.exec(`INSERT INTO public.crm_leads(patient_id,source,created_at) VALUES(3,'facebook','2026-05-01'),(3,'referral','2026-05-01');`)
 await rebuild(3)
 r=await scalar('SELECT * FROM public.patient_marketing_attribution WHERE patient_id=3')
 assert.equal(r.attribution_status,'conflicting_source');assert.equal(r.validated_source,null);tests++
 // A late touch cannot own acquisition or pre-contact revenue.
 await db.exec(`INSERT INTO public.crm_leads(patient_id,source,created_at) VALUES(4,'facebook','2026-07-01');`)
 await rebuild(4)
 r=await scalar('SELECT * FROM public.patient_marketing_attribution WHERE patient_id=4')
 assert.equal(r.attribution_status,'late_source');assert.equal(r.validated_source,null);tests++
 // Exact hospital-number referral evidence fills missing source with provenance.
 await db.exec(`INSERT INTO public.referral_patient_report(hospital_number,reg_date,mpo_name) VALUES('H-5','2026-05-01','Dr. Synthetic Referral');`)
 await rebuild(5)
 r=await scalar('SELECT * FROM public.patient_marketing_attribution WHERE patient_id=5')
 assert.equal(r.first_touch_source,'doctor recommendation');assert.equal(r.first_touch_evidence_table,'referral_patient_report');tests++
 // Revoked evidence retracts source/metadata, including previously strong fields.
 await db.exec('DELETE FROM public.referral_patient_report WHERE hospital_number=\'H-5\'')
 await rebuild(5)
 r=await scalar('SELECT * FROM public.patient_marketing_attribution WHERE patient_id=5')
 assert.equal(r.attribution_status,'missing_source');assert.equal(r.is_authenticated,false);assert.equal(r.campaign_id,null);tests++
 // A Google Sheet import timestamp does not prove an original acquisition date.
 await db.exec(`INSERT INTO public.crm_leads(patient_id,source,source_system,created_at) VALUES(5,'facebook','google_sheet_backfill','2026-05-01');`)
 await rebuild(5)
 assert.equal((await scalar('SELECT attribution_status FROM public.patient_marketing_attribution WHERE patient_id=5')).attribution_status,'unauthenticated_source');tests++
 // Outbound follow-up never becomes a new acquisition.
 await db.exec(`DELETE FROM public.crm_leads WHERE patient_id=5; INSERT INTO public.crm_leads(patient_id,source,call_direction,created_at) VALUES(5,'facebook','outgoing','2026-05-01');`)
 await rebuild(5)
 assert.equal((await scalar('SELECT attribution_status FROM public.patient_marketing_attribution WHERE patient_id=5')).attribution_status,'outbound_only');tests++
 // Every original source mutation advances durable reconciliation state.
 assert.ok(Number((await scalar('SELECT revision FROM mis_internal.marketing_reconciliation_state')).revision)>0);tests++
 // Durable Meta pagination, natural-key deduplication, and currency preservation.
 await db.exec(`INSERT INTO public.marketing_daily_spend(date,meta_campaign_id,meta_adset_id,meta_ad_id,spend_usd) VALUES(current_date-8,'baseline','baseline','baseline',1)`)
 const today=(await scalar('SELECT current_date::text today')).today
 const claim=async()=> (await scalar('SELECT public.claim_marketing_spend_sync($1,$2) r',['123456',today])).r
 let lease=await claim()
 assert.equal((await claim()).status,'busy');tests++
 const row={ad_id:'11111',adset_id:'22222',campaign_id:'33333',date_start:lease.since,date_stop:lease.since,spend:'10.50',impressions:'100'}
 const save=(token,rows,cursor=null,currency='USD')=>db.query('SELECT public.apply_marketing_spend_page($1,$2,$3,$4,$5,$6)',['123456',token,today,currency,JSON.stringify(rows),cursor])
 await assert.rejects(save(lease.token,[row],null,'EUR'));tests++
 const firstToken=lease.token
 await save(firstToken,[row],'page-2')
 await assert.rejects(save(firstToken,[row]));tests++
 lease=await claim();assert.equal(lease.after,'page-2')
 await save(lease.token,[{...row,spend:'12.34'}])
 assert.equal(Number((await scalar(`SELECT count(*) n FROM public.marketing_daily_spend WHERE meta_ad_id='11111'`)).n),1)
 const money=await scalar(`SELECT spend_usd,spend_bdt FROM public.marketing_daily_spend WHERE meta_ad_id='11111'`)
 assert.equal(Number(money.spend_usd),12.34);assert.equal(money.spend_bdt,null);tests++
 assert.equal(Number((await scalar('SELECT count(*) n FROM mis_internal.marketing_spend_observations')).n),2)
 await assert.rejects(db.exec('DELETE FROM mis_internal.marketing_spend_observations WHERE true'));tests++
 assert.equal((await claim()).status,'idle');tests++
 await db.exec(`SET request.jwt.claim.role='authenticated'`)
 await assert.rejects(claim());tests++
 await db.exec(`SET request.jwt.claim.role='service_role'`)
 // Preserve legacy history and project only spend backed by immutable API pages.
 await db.exec(`INSERT INTO public.meta_ad_spend_daily(spend_date,ad_account_id,currency,ad_id,amount_spent) VALUES(current_date-30,'123456','USD','historic',7);`)
 await db.exec(await readFile(new URL('supabase/migrations/20261025003902_marketing_spend_compatibility_projection.sql',root),'utf8'))
 assert.equal(Number((await scalar('SELECT count(*) n FROM mis_internal.marketing_spend_legacy_baseline')).n),1)
 await assert.rejects(db.exec('DELETE FROM mis_internal.marketing_spend_legacy_baseline WHERE true'));tests++
 assert.equal(Number((await scalar(`SELECT amount_spent FROM public.meta_ad_spend_daily WHERE ad_id='11111'`)).amount_spent),12.34)
 assert.equal(Number((await scalar(`SELECT count(*) n FROM public.meta_ad_spend_daily WHERE ad_id='historic'`)).n),1);tests++
 await db.exec(`UPDATE public.marketing_daily_spend SET updated_at=now() WHERE meta_ad_id='11111'`)
 assert.equal(Number((await scalar(`SELECT count(*) n FROM public.meta_ad_spend_daily WHERE ad_id='11111'`)).n),1);tests++
 await db.exec(`INSERT INTO public.marketing_daily_spend(date,meta_campaign_id,meta_adset_id,meta_ad_id,spend_usd,source_payload) VALUES(current_date,'33333','22222','forged',99,'{"integration":"meta_ads_insights","observation_id":"1","account_id":"123456","currency":"USD","data":{"ad_id":"forged"}}')`)
 assert.equal(Number((await scalar(`SELECT count(*) n FROM public.meta_ad_spend_daily WHERE ad_id='forged'`)).n),0);tests++
 console.log(`PASS: ${tests} synthetic marketing evidence scenarios.`)
} finally {await db.close()}


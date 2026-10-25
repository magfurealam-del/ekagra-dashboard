import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'

const root = new URL('../../', import.meta.url)
const read = async (path) => readFile(new URL(path, root), 'utf8')
let fixture
try { fixture = JSON.parse(await read('docs/database-baseline/private/gateway-schema-contract.json')) }
catch {
 console.log('SKIP: live-schema integration snapshot is local only; parser and worker checks still run.')
 process.exit(0)
}
const { PGlite } = await import('@electric-sql/pglite')
const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto')
const db = new PGlite({ extensions: { pgcrypto } })
let tests = 0
try {
 await db.exec(`CREATE SCHEMA mis_internal; CREATE SCHEMA extensions; CREATE SCHEMA auth;
 CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('role',auth.role(),'sub',auth.uid()) $$;
 SET check_function_bodies=off;`)
 // Real column types, nullability, unique indexes, checks and reconciliation functions.
 // Sequence names are reconstructed from defaults; there is no production data.
 for (const f of fixture.functions.filter(f=>f.name.startsWith('normalize_'))) await db.exec(f.ddl)
 for (const t of fixture.tables) {
  for (const match of t.columns.matchAll(/nextval\('([^']+)'::regclass\)/g)) {
   await db.exec(`CREATE SEQUENCE IF NOT EXISTS ${match[1]}`)
  }
  await db.exec(`CREATE TABLE ${t.schema}.${t.name} (${t.columns})`)
 }
 const marketingContract=JSON.parse(await read('docs/database-baseline/private/gateway-marketing-schema-contract.json'))
 for (const t of marketingContract) {
  for (const match of t.columns.matchAll(/nextval\('([^']+)'::regclass\)/g)) await db.exec(`CREATE SEQUENCE IF NOT EXISTS ${match[1]}`)
  await db.exec(`CREATE TABLE ${t.schema}.${t.name} (${t.columns})`)
  for (const ddl of t.indexes) await db.exec(ddl)
 }
 await db.exec(await read('scripts/mis-upload/marketing-test-schema.sql'))
 for (const f of fixture.functions) await db.exec(f.ddl)
 // Views are loaded in dependency order, with no synthetic replacement of their SQL.
 let views=[...(fixture.views??[])]; let lastError
 while (views.length) {
  const pending=[]
  for (const v of views) {
   try { await db.exec(`CREATE VIEW ${v.schema}.${v.name} AS ${v.definition}`) }
   catch(error) { pending.push(v); lastError=error }
  }
  if (pending.length===views.length) throw lastError
  views=pending
 }
 for (const o of fixture.objects) await db.exec(o.ddl)
 for (const fk of fixture.foreignKeys) await db.exec(fk.ddl)
 for (const t of fixture.triggers) { await db.exec(t.fn); await db.exec(t.def) }
 // Intake immutability triggers are part of the live contract, not function mocks.
 const intake = await read('supabase/migrations/20261023130728_mis_upload_immutable_intake.sql')
 await db.exec(intake.slice(intake.indexOf('CREATE OR REPLACE FUNCTION mis_internal.reject_mis_upload_history_mutation()'),intake.indexOf('DO $rls$')))
 for (const file of ['20261024123917_mis_upload_review_detail.sql','20261024133348_mis_upload_authoritative_pipeline.sql','20261024133408_mis_upload_resumable_intake.sql','20261024133414_mis_upload_publication_barriers.sql','20261024203229_mis_upload_allow_line_level_department_attribution.sql','20261024203816_mis_upload_review_rpc_named_parameters.sql','20261024212502_mis_upload_skip_verified_unchanged_inventory_invoices.sql','20261024212638_mis_upload_clear_stale_unchanged_job_errors.sql','20261024212832_mis_upload_safe_shadow_rebuild_deletes.sql','20261024213735_mis_upload_resumable_lifetime_publication.sql','20261024214007_mis_upload_safe_contact_history_rebuild.sql','20261024220231_mis_gateway_reconciliation_row_counters_and_source_evidence.sql']) {
  await db.exec(await read(`supabase/migrations/${file}`))
 }
 await db.exec(await read('supabase/migrations/20261025002551_mis_upload_marketing_reconciliation.sql'))
 await db.exec(await read('supabase/migrations/20261025002604_marketing_spend_sync_gateway.sql'))
 await db.exec(await read('supabase/migrations/20261025003902_marketing_spend_compatibility_projection.sql'))
 await db.exec(await read('supabase/migrations/20261025004303_marketing_publication_completion_guard.sql'))
 await db.exec(await read('supabase/migrations/20261025013715_verified_marketing_identity_evidence.sql'))
 await db.exec(await read('supabase/migrations/20261025014102_marketing_identity_bridge_invalidation.sql'))
 const scalar = async (sql, params=[]) => (await db.query(sql,params)).rows[0]
 await db.exec(`INSERT INTO public.user_profiles(id,role,is_active) VALUES('00000000-0000-4000-8000-000000000001','admin',true);
 INSERT INTO public.service_categories(id,name) VALUES(10,'Synthetic Medicine');
 SET request.jwt.claim.role='service_role';`)
 const actor = '00000000-0000-4000-8000-000000000001'
 const base = { doctors_department:'Test',hospital_number:'HNTEST1',patient_name:'Synthetic Patient',gender:'Male',
  age_years:30,birth_year:1996,phone_mobile:'01700000000',marital_status:null,blood_group:null,address:null,
  patient_type:'OPD',bill_module_name:'Consultation',admission_id:null,admission_date:null,discharge_date:null,
  invoice_id:'TEST-1',invoice_by:'synthetic',invoice_date:'2026-06-01',invoice_datetime:'2026-06-01',
  doctor_name:'Synthetic Doctor',second_doctor_name:null,contributor_doctor_name:null,mpo_name:null,
  parent_item_type_name:'Services',item_type_name:'OPD Services',business_unit_name:null,item_id:'TEST-CONSULT',
  item_name:'Consultation',sales_amount:'100.0000',item_discount:'0.0000',net_sales:'100.0000',net_collection:'100.0000',cancellation_amount:'0.0000' }
 let seq=0
 async function enqueue(values) {
  seq++
  const upload=(await scalar(`INSERT INTO mis_internal.mis_upload_files(source_file_sha256,storage_object_key,original_file_name,byte_count,declared_media_type,received_by)
   VALUES(md5($1)||md5($1),$1,'synthetic.csv',100,'text/csv',$2) RETURNING id`,[String(seq),actor])).id
  const parse=(await scalar(`INSERT INTO mis_internal.mis_upload_parses(upload_id,parser_name,parser_version,schema_version,normalization_version,reference_year,source_row_count,header_sha256,rowset_sha256,status)
   VALUES($1,'mis-csv-parser','v1','v1','v1',2026,$2,repeat('0',64),repeat('0',64),'parsing') RETURNING id`,[upload,values.length])).id
  for(let n=0;n<values.length;n++) await db.query(`INSERT INTO mis_internal.mis_upload_rows(parse_id,source_row_number,raw_cells,normalized_values,row_sha256) VALUES($1,$2,'[]',$3,repeat('0',64))`,[parse,n+2,JSON.stringify(values[n])])
  await db.query(`UPDATE mis_internal.mis_upload_parses SET status='sealed',sealed_at=now() WHERE id=$1`,[parse])
  await db.query(`INSERT INTO mis_internal.mis_upload_state(upload_id,state,active_parse_id) VALUES($1,'validated',$2)`,[upload,parse])
  const batch=(await scalar(`SELECT mis_internal.enqueue_mis_upload($1,$2) r`,[actor,upload])).r
  const job=(await scalar(`SELECT id FROM mis_internal.mis_gateway_jobs WHERE batch_id=$1`,[batch.batchId])).id
  return {upload,parse,batch,job}
 }
 async function apply(job) {
  // Same explicit transaction boundary as the RPC. Temporary tables drop on commit.
  return db.transaction(async tx => (await tx.query(`SELECT mis_internal.apply_gateway_invoice($1) r`,[job])).rows[0].r)
 }
 const first=await enqueue([base,{...base,item_id:'TEST-OTHER',item_name:'Second consultation'}])
 assert.equal((await apply(first.job)).status,'completed'); tests++
 assert.deepEqual(await scalar(`SELECT rows_read,rows_inserted,rows_updated,rows_skipped_duplicates,rows_rejected FROM public.mis_reconciliation_runs WHERE mis_import_id=(SELECT import_id FROM mis_internal.mis_gateway_jobs WHERE id=$1)`,[first.job]),
  {rows_read:2,rows_inserted:2,rows_updated:0,rows_skipped_duplicates:0,rows_rejected:0}); tests++
 assert.deepEqual((await scalar(`SELECT proargnames FROM pg_proc WHERE oid='public.get_mis_upload_review(uuid,uuid)'::regprocedure`)).proargnames,['p_actor_id','p_upload_id'])
 assert.equal((await scalar('SELECT public.get_mis_upload_review(p_actor_id=>$1,p_upload_id=>$2) r',[actor,first.upload])).r.fileName,'synthetic.csv'); tests++
 assert.equal(Number((await scalar('SELECT count(*) n FROM public.mis_reports')).n),2)
 const repeated=await enqueue([{...base,item_id:'TEST-OTHER',item_name:'Second consultation'},base])
 assert.equal((await apply(repeated.job)).action,'unchanged'); tests++
 const canonical=await scalar(`SELECT i.id invoice_id,l.id line_id FROM public.invoices i JOIN public.invoice_line_items l ON l.invoice_id=i.id WHERE lower(i.invoice_no)='test-1' ORDER BY l.id LIMIT 1`)
 await db.query(`UPDATE mis_internal.mis_gateway_jobs SET status='superseded' WHERE invoice_key='test-1' AND status='completed'`)
 await db.query(`INSERT INTO public.invoice_inventory_movements(invoice_line_item_id,invoice_id,movement_type,movement_date,item_name,quantity,source,status)
  VALUES($1,$2,'consumption','2026-06-01','Synthetic inventory guard test',1,'test','posted')`,[canonical.line_id,canonical.invoice_id])
 const firstAdoption=await enqueue([{...base,item_id:'TEST-OTHER',item_name:'Second consultation'},base])
 await db.query(`UPDATE mis_internal.mis_gateway_jobs SET error_code='23503' WHERE id=$1`,[firstAdoption.job])
 assert.equal((await apply(firstAdoption.job)).action,'unchanged')
 assert.equal((await scalar(`SELECT error_code FROM mis_internal.mis_gateway_jobs WHERE id=$1`,[firstAdoption.job])).error_code,null)
 assert.equal(Number((await scalar(`SELECT count(*) n FROM public.invoice_inventory_movements WHERE invoice_line_item_id=$1`,[canonical.line_id])).n),1); tests++
 await db.query(`DELETE FROM public.invoice_inventory_movements WHERE invoice_line_item_id=$1`,[canonical.line_id])
 const corrected=await enqueue([{...base,hospital_number:'HNTEST2',patient_name:'Synthetic Corrected Patient',net_sales:'80.0000',item_discount:'20.0000',net_collection:'80.0000'}])
 assert.equal((await apply(corrected.job)).status,'completed')
 assert.equal(Number((await scalar('SELECT count(*) n FROM public.mis_reports')).n),1)
 assert.equal(Number((await scalar('SELECT count(*) n FROM public.invoice_line_items')).n),1)
 assert.equal((await scalar('SELECT net_bill::text n FROM public.invoices')).n,'80.00'); tests++
 assert.equal(Number((await scalar(`SELECT jsonb_array_length(previous_rows) n FROM mis_internal.mis_gateway_invoice_history WHERE job_id=$1`,[corrected.job])).n),2); tests++
 const multis=await enqueue([base,base]); await apply(multis.job)
 assert.equal(Number((await scalar('SELECT count(*) n FROM public.invoice_line_items')).n),2); tests++
 const lineAttribution=await enqueue([
  {...base,invoice_id:'TEST-LINE-ATTRIBUTION',doctors_department:'Department A',contributor_doctor_name:'Doctor A'},
  {...base,invoice_id:'TEST-LINE-ATTRIBUTION',item_id:'TEST-LINE-OTHER',item_name:'Second consultation',doctors_department:'Department B',contributor_doctor_name:'Doctor B'}
 ])
 assert.equal(lineAttribution.batch.invoiceCount,1)
 assert.equal((await apply(lineAttribution.job)).status,'completed')
 assert.deepEqual((await db.query(`SELECT doctors_department,contributor_doctor_name FROM public.mis_reports WHERE invoice_id_raw='test-line-attribution' ORDER BY item_id_raw`)).rows,
  [{doctors_department:'Department A',contributor_doctor_name:'Doctor A'},{doctors_department:'Department B',contributor_doctor_name:'Doctor B'}]); tests++
 const bad=await enqueue([{...base,birth_year:2300}])
 await assert.rejects(apply(bad.job))
 assert.equal(Number((await scalar('SELECT count(*) n FROM public.mis_reports')).n),4)
 assert.equal(Number((await scalar('SELECT count(*) n FROM mis_internal.mis_gateway_invoice_history WHERE job_id=$1',[bad.job])).n),0); tests++
 await assert.rejects(db.query('DELETE FROM mis_internal.mis_gateway_invoice_history'))
 await assert.rejects(db.query('UPDATE mis_internal.mis_upload_rows SET normalized_values=\'{}\'')); tests++
 await assert.rejects(enqueue([base,{...base,hospital_number:'CONFLICT'}])); tests++
 await db.exec(`SET request.jwt.claim.role='authenticated'`)
 await assert.rejects(db.query('SELECT mis_internal.enqueue_mis_upload($1,$2)',[actor,first.upload]))
 await assert.rejects(db.query('SELECT mis_internal.mis_gateway_tick()')); tests++
 const acl=await scalar(`SELECT has_function_privilege('authenticated','public.enqueue_mis_upload(uuid,uuid)','execute') denied`)
 assert.equal(acl.denied,false); tests++
 await db.exec(`SET request.jwt.claim.role='service_role'; SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';`)
 // Controllable clock for scheduling tests only. All reconciliation SQL remains the live definition.
 await db.exec(`CREATE OR REPLACE FUNCTION mis_internal.is_overnight() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.overnight',true)='on' $$;
 SET test.overnight='off';`)
 assert.equal((await scalar('SELECT mis_internal.mis_gateway_tick() r')).r.status,'outside_overnight_window'); tests++
 await db.exec(`SET test.overnight='on'`)
 // Failure through the actual worker must persist a retry while source changes roll back.
 const failedTick=(await scalar('SELECT mis_internal.mis_gateway_tick() r')).r
 assert.equal(failedTick.status,'retry')
 assert.equal((await scalar('SELECT attempts FROM mis_internal.mis_gateway_jobs WHERE id=$1',[bad.job])).attempts,1); tests++
 const fix=await enqueue([base]); await apply(fix.job)
 const refund=await enqueue([{...base,invoice_id:'TEST-REFUND',sales_amount:'-10.1441',net_sales:'-10.1441',net_collection:'-10.1441'}])
 await apply(refund.job)
 assert.equal((await scalar(`SELECT total_refund::text amount FROM public.invoices WHERE invoice_no='test-refund'`)).amount,'10.14'); tests++
 // Older failed work cannot overwrite a newer successful authoritative snapshot.
 assert.equal((await apply(bad.job)).status,'superseded'); tests++
 assert.equal((await scalar('SELECT mis_internal.gateway_publication_blocked() blocked')).blocked,true); tests++
 const hn='HNCLINICAL',doctor='Synthetic Doctor'
 const pharmacy=await enqueue([{...base,invoice_id:'CLINIC-PHARM',hospital_number:hn,item_name:'Medicine',item_type_name:'Pharmacy',parent_item_type_name:'Pharmacy',bill_module_name:'Pharmacy'}])
 await apply(pharmacy.job)
 const patient=(await scalar('SELECT id FROM public.patients WHERE hn=$1',[hn])).id
 const lead=(await scalar(`INSERT INTO public.crm_leads(patient_id,lead_name,phone,created_at) VALUES($1,'Synthetic Lead','01700000000','2026-05-01') RETURNING id`,[patient])).id
 const appointment=(await scalar(`INSERT INTO public.crm_appointments(patient_id,lead_id,appointment_date,doctor_service,appointment_status)
  VALUES($1,$2,'2026-06-01',$3,'Scheduled') RETURNING id`,[patient,lead,doctor])).id
 const consult=await enqueue([{...base,invoice_id:'CLINIC-VISIT',hospital_number:hn}]); await apply(consult.job)
 const visit=await scalar(`SELECT a.visit_verified,i.invoice_no FROM public.crm_appointments a JOIN public.invoices i ON i.id=a.matched_invoice_id WHERE a.id=$1`,[appointment])
 assert.equal(visit.visit_verified,true); assert.equal(visit.invoice_no,'clinic-visit'); tests++
 const moved=await enqueue([{...base,invoice_id:'CLINIC-VISIT',hospital_number:'HNCORRECTED'}]); await apply(moved.job)
 assert.equal((await scalar('SELECT visit_verified FROM public.crm_appointments WHERE id=$1',[appointment])).visit_verified,false)
 assert.equal((await scalar('SELECT first_invoice_id FROM public.crm_leads WHERE id=$1',[lead])).first_invoice_id,null); tests++
 // Resume interrupted staging via another attempt for the identical file.
 const hash=s=>createHash('sha256').update(s).digest('hex'),rawCells=['synthetic'],rowHash=hash(JSON.stringify(rawCells))
 const manifest={parserVersion:'mis-csv-parser-v1',schemaVersion:'ekagra-mis-csv-v1',normalizationVersion:'mis-normalization-v1',referenceYear:2026,sourceRowCount:1,blankRecordCount:0,headerSha256:hash('header'),rowsetSha256:hash(`2:${rowHash}\n`)}
 const reserve=async()=> (await scalar(`SELECT mis_internal.reserve_mis_upload($1,$2,'resume.csv',100,'text/csv') r`,[actor,randomUUID()])).r
 const reservation=await reserve(), sha=hash('resume-source')
 const prepare=async(a,m=manifest)=>(await scalar('SELECT mis_internal.prepare_mis_upload($1,$2,$3,100,$4) r',[actor,a,sha,JSON.stringify(m)])).r
 const prepared=await prepare(reservation.attemptId)
 const row={sourceRowNumber:2,rawCells,normalizedValues:{...base,invoice_id:'RESUME'},rowSha256:rowHash,issues:[]}
 const stage=async(a,p,r=row)=>db.query('SELECT mis_internal.stage_mis_upload_rows($1,$2,$3,$4)',[actor,a,p,JSON.stringify([r])])
 await stage(reservation.attemptId,prepared.parseId)
 const secondReservation=await reserve(), resumed=await prepare(secondReservation.attemptId)
 assert.equal(resumed.parseId,prepared.parseId)
 await stage(secondReservation.attemptId,resumed.parseId)
 await assert.rejects(stage(secondReservation.attemptId,resumed.parseId,{...row,normalizedValues:{...row.normalizedValues,net_sales:'999'}}))
 const completed=(await scalar('SELECT mis_internal.complete_mis_upload($1,$2,$3,true) r',[actor,secondReservation.attemptId,resumed.parseId])).r
 assert.ok(completed.pipeline.batchId)
 assert.equal((await scalar('SELECT mis_internal.complete_mis_upload($1,$2,$3,true) r',[actor,secondReservation.attemptId,resumed.parseId])).r.pipeline.batchId,completed.pipeline.batchId); tests++
 assert.equal((await prepare(secondReservation.attemptId)).sealed,true)
 await assert.rejects(prepare(secondReservation.attemptId,{...manifest,referenceYear:2025})); tests++
 // Campaign revenue must survive multiple appointments without multiplying invoices.
 const adPatient=(await scalar(`SELECT id FROM public.patients WHERE hn='HNTEST1'`)).id
 const adLead=(await scalar(`INSERT INTO public.crm_leads(patient_id,lead_name,phone,source,created_at) VALUES($1,'Synthetic Campaign Lead','01700000000','facebook','2026-05-01') RETURNING id`,[adPatient])).id
 await db.query(`UPDATE public.crm_leads SET phone_normalized='+8801700000000',meta_ad_id='synthetic-ad' WHERE id=$1`,[adLead])
 await db.query(`INSERT INTO public.crm_leads(patient_id,lead_name,phone,phone_normalized,source,created_at,meta_ad_id) VALUES($1,'Synthetic Campaign Lead Second Phone','01700000001','+8801700000001','facebook','2026-05-02','synthetic-ad')`,[adPatient])
 await db.query(`INSERT INTO public.lead_attribution(lead_id,patient_id,source_category,attribution_level,attribution_confidence,first_touch_date,meta_campaign_id,meta_ad_id) VALUES($1,$2,'facebook','exact_ad',1,'2026-05-01','synthetic-campaign','synthetic-ad')`,[adLead,adPatient])
 await db.query(`INSERT INTO public.crm_appointments(patient_id,lead_id,appointment_date,doctor_service,appointment_status) VALUES($1,$2,'2026-06-01','Synthetic Doctor','Scheduled'),($1,$2,'2026-06-01','Synthetic Other','Scheduled')`,[adPatient,adLead])
 const preAcquisition=await enqueue([{...base,invoice_id:'PRE-ACQ',invoice_date:'2026-04-01',invoice_datetime:'2026-04-01',item_name:'Medicine',item_type_name:'Pharmacy',parent_item_type_name:'Pharmacy',bill_module_name:'Pharmacy'}])
 await apply(preAcquisition.job)
 // Run the REAL finance, lifetime and contact-ledger functions, not success stubs.
 await db.exec(`INSERT INTO public.dashboard_metric_snapshots(snapshot_key,start_date,end_date,metrics) VALUES('2026-06-01:2026-06-30','2026-06-01','2026-06-30','{}');`)
 const stages=[]
 for(let n=0;n<40;n++) {
  const r=(await scalar('SELECT mis_internal.mis_gateway_tick() r')).r
  stages.push(r)
  if(r.status==='idle') break
 }
 assert.equal(stages.at(-1)?.status,'idle',JSON.stringify(stages))
 assert.ok(stages.every(x=>['completed','advanced','idle','superseded'].includes(x.status)),JSON.stringify(stages))
 assert.ok(stages.some(x=>x.stage==='marketing'))
 assert.equal((await scalar('SELECT rules_version FROM mis_internal.mis_gateway_publication')).rules_version,'marketing_pipeline_v2')
 assert.equal((await scalar('SELECT mis_internal.gateway_publication_blocked() blocked')).blocked,false)
 assert.equal(Number((await scalar('SELECT count(*) n FROM mis_internal.shadow_invoice_attribution')).n),Number((await scalar('SELECT count(*) n FROM public.invoices')).n))
 assert.equal((await scalar('SELECT integrity_passed FROM mis_internal.shadow_attribution_runs ORDER BY id DESC LIMIT 1')).integrity_passed,true); tests++
 assert.notDeepEqual((await scalar('SELECT metrics FROM public.dashboard_metric_snapshots')).metrics,{}); tests++
 const adReport=(await scalar(`SELECT public.get_ad_attribution_report('2026-06-01','2026-06-30') r`)).r
 const expectedRevenue=Number((await scalar(`SELECT sum(net_bill) revenue FROM public.invoices WHERE patient_id=$1 AND invoice_date BETWEEN '2026-06-01' AND '2026-06-30'`,[adPatient])).revenue)
 assert.equal(Number(adReport.find(x=>x.campaign_id==='synthetic-campaign').revenue),expectedRevenue)
 assert.equal(Number((await scalar(`SELECT sum(net_revenue_bdt) n FROM public.meta_phone_ad_outcomes_current WHERE meta_ad_id='synthetic-ad'`)).n),expectedRevenue)
 assert.equal((await scalar(`SELECT a.attributed_source FROM mis_internal.shadow_invoice_attribution a JOIN public.invoices i ON i.id=a.invoice_id WHERE i.invoice_no='pre-acq'`)).attributed_source,null)
 assert.equal((await scalar(`SELECT m.source_category FROM public.vw_finance_invoice_marketing m JOIN public.invoices i ON i.id=m.invoice_id WHERE i.invoice_no='pre-acq'`)).source_category,'unattributed'); tests++
 const sourceReport=(await scalar(`SELECT public.get_admin_source_performance('2026-06-01','2026-06-30') r`)).r
 const reportedRevenue=sourceReport.sources.reduce((sum,x)=>sum+Number(x.revenue_new)+Number(x.revenue_followup),0)
 assert.equal(reportedRevenue,Number((await scalar(`SELECT sum(net_bill) n FROM public.invoices WHERE invoice_date BETWEEN '2026-06-01' AND '2026-06-30'`)).n)); tests++
 // A source edit restarts marketing publication without replaying invoice jobs.
 const priorRun=(await scalar('SELECT max(id) id FROM mis_internal.marketing_reconciliation_runs')).id
 const priorLifetimeRun=(await scalar('SELECT max(id) id FROM mis_internal.shadow_attribution_runs')).id
 const sourceRowsBefore=Number((await scalar('SELECT count(*) n FROM public.mis_reports')).n)
 await db.query(`UPDATE public.crm_leads SET source='facebook' WHERE id=$1`,[lead])
 assert.equal((await scalar('SELECT mis_internal.gateway_publication_blocked() b')).b,true)
 assert.equal((await scalar('SELECT mis_internal.mis_gateway_tick() r')).r.stage,'marketing')
 await db.query(`UPDATE public.crm_leads SET source='referral' WHERE id=$1`,[lead])
 let sourceRefresh
 const sourceStages=[]
 for(let n=0;n<40;n++) { sourceRefresh=(await scalar('SELECT mis_internal.mis_gateway_tick() r')).r; sourceStages.push(sourceRefresh.stage); if(sourceRefresh.status==='idle') break }
 assert.equal(sourceRefresh.status,'idle')
 assert.equal((await scalar('SELECT stage FROM mis_internal.mis_gateway_publication')).stage,'complete')
 assert.ok((await scalar('SELECT max(id) id FROM mis_internal.shadow_attribution_runs')).id>priorLifetimeRun)
 assert.ok(['lifetime','contacts','ad_outcomes','snapshots'].every(stage=>sourceStages.includes(stage)))
 assert.ok((await scalar('SELECT max(id) id FROM mis_internal.marketing_reconciliation_runs')).id>priorRun)
 assert.ok(Number((await scalar(`SELECT count(*) n FROM mis_internal.marketing_reconciliation_runs WHERE status='superseded'`)).n)>0)
 assert.equal(Number((await scalar('SELECT count(*) n FROM public.mis_reports')).n),sourceRowsBefore); tests++
 // A pharmacy-only bill must not change a booking or infer attendance/No-show.
 const negative=(await scalar(`INSERT INTO public.crm_appointments(patient_id,appointment_date,doctor_service,appointment_status)
  VALUES($1,'2026-06-01',$2,'No-show') RETURNING id`,[patient,doctor])).id
 await db.query(`SELECT public._sync_appointment_status_from_invoices_core(false,'2026-01-01','synthetic')`)
 assert.equal((await scalar('SELECT appointment_status FROM public.crm_appointments WHERE id=$1',[negative])).appointment_status,'No-show')
 assert.equal((await scalar('SELECT visit_verified FROM public.crm_appointments WHERE id=$1',[appointment])).visit_verified,false); tests++
 console.log(`PASS: ${tests} PostgreSQL ingestion scenarios; live schema contract, synthetic rows only.`)
} catch (error) {
 console.error('FAIL:',error.message,'DETAIL:',error.detail,'CONTEXT:',error.where)
 process.exitCode=1
} finally { await db.close() }

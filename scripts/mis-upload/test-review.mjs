import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
const root = new URL('../../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
const db = new PGlite({ extensions: { pgcrypto } })
const actor = '00000000-0000-4000-8000-000000000001'
const agent = '00000000-0000-4000-8000-000000000002'
const inactive = '00000000-0000-4000-8000-000000000003'
const scalar = async (sql, params=[]) => (await db.query(sql, params)).rows[0]
let tests = 0
const check = (condition, label) => { assert.ok(condition, label); tests++ }
const reject = async (call, pattern) => { await assert.rejects(call, pattern); tests++ }
try {
 await db.exec(`CREATE SCHEMA mis_internal; CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('role',auth.role())$$;
 SET request.jwt.claim.role='service_role';
 CREATE FUNCTION public.normalize_hospital_identifier(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT upper(regexp_replace($1,'[^a-zA-Z0-9]','','g'))$$;
 CREATE FUNCTION public.normalize_marketing_source(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT nullif(lower(btrim($1)),'')$$;
 CREATE FUNCTION public.normalize_bd_phone(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT $1$$;
 CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,role text,is_active boolean);
 CREATE TABLE mis_internal.mis_gateway_batches(id bigint PRIMARY KEY);
 CREATE TABLE mis_internal.mis_gateway_jobs(id bigint PRIMARY KEY,status text);
 CREATE TABLE mis_internal.mis_gateway_publication(singleton boolean PRIMARY KEY DEFAULT true,stage text,marketing_revision bigint,rules_version text,published_batch_id bigint,target_batch_id bigint);
 CREATE TABLE mis_internal.shadow_attribution_runs(id bigint PRIMARY KEY,status text,integrity_passed boolean,rule_version text);
 CREATE TABLE mis_internal.shadow_invoice_attribution(invoice_id bigint PRIMARY KEY,patient_id integer,invoice_date date,attributed_source text,attribution_class text,net_bill numeric,run_id bigint);
 CREATE TABLE mis_internal.shadow_patient_acquisitions(patient_id integer PRIMARY KEY,first_clinical_invoice_date date,source text,source_event_date date,run_id bigint);
 CREATE FUNCTION mis_internal.assert_mis_upload_admin(p_actor_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=p_actor_id AND role='admin' AND is_active) THEN RAISE EXCEPTION 'active administrator required' USING ERRCODE='42501'; END IF; END$$;
 CREATE FUNCTION mis_internal.is_overnight() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 INSERT INTO public.user_profiles VALUES('${actor}','admin',true),('${agent}','call_center_agent',true),('${inactive}','admin',false);`)
 await db.exec(await read('scripts/mis-upload/marketing-test-schema.sql'))
 await db.exec(await read('scripts/mis-upload/review-test-schema.sql'))
 const core = await read('supabase/migrations/20261025002551_mis_upload_marketing_reconciliation.sql')
 await db.exec(core.slice(0,core.indexOf('CREATE FUNCTION mis_internal.refresh_gateway_marketing_attribution')))
 await db.exec(await read('supabase/migrations/20261025002604_marketing_spend_sync_gateway.sql'))
 await db.exec(await read('supabase/migrations/20261025013715_verified_marketing_identity_evidence.sql'))
 const migration = (await readdir(new URL('supabase/migrations/',root))).find(f=>f.endsWith('_admin_attribution_review.sql'))
 await db.exec(await read('supabase/migrations/'+migration))
 const detailsMigration = (await readdir(new URL('supabase/migrations/',root))).find(f=>f.endsWith('_admin_review_source_record_details.sql'))
 await db.exec(await read('supabase/migrations/'+detailsMigration))
 const readCase = async (kind,id,who=actor,page=0,filter='',search='') => (await scalar('SELECT public.marketing_review_read($1,$2,$3,$4,$5,$6) r',[who,kind,id,page,filter,search])).r
 const version = async (kind,id) => (await readCase(kind,id)).version
 const resolve = async (kind,id,payload,opts={}) => (await scalar('SELECT public.marketing_review_resolve($1,$2,$3,$4,$5,$6) r',[opts.actor||actor,opts.requestId||randomUUID(),kind,id,opts.version||await version(kind,id),JSON.stringify(payload)])).r
 const notes = 'Checked the original synthetic registration and hospital identity.'
 await db.exec(`INSERT INTO public.patients(id,hn,full_name,phone_e164) VALUES(1,'H1','Synthetic One','+8801700000001'),(2,'H2','Synthetic Two','+8801700000001');
 INSERT INTO public.invoices(id,patient_id,invoice_date,net_bill,invoice_no) VALUES(1,1,'2026-06-01',100,'I1'),(2,2,'2026-06-01',200,'I2');
 INSERT INTO public.invoice_line_items(invoice_id,particulars) VALUES(1,'Consultation'),(2,'Consultation');
 INSERT INTO public.crm_leads(id,patient_id,lead_name,phone,source,created_at) VALUES(1,1,'Synthetic One','+8801700000001','unknown','2026-05-01'),(2,2,'Synthetic Two','+8801700000001','unknown','2026-05-01');
 INSERT INTO public.messenger_contacts(id,psid,page_id,phone) VALUES(1,'s1','p1','+8801700000001');
 INSERT INTO public.meta_message_phone_candidates(id,psid,page_id,phone_e164,phone_last4,reconciliation_status) VALUES(1,'s1','p1','+8801700000001','0001','unreconciled'),(2,'s1','p1','+8801700000002','0002','unreconciled');
 INSERT INTO public.meta_call_center_reconciliation(id,meta_candidate_id,review_status) VALUES(1,1,'unreviewed'),(2,2,'unreviewed');
 INSERT INTO public.messenger_events(id,psid,page_id,message_text,received_at) VALUES('00000000-0000-4000-8000-000000000004','s1','p1','Synthetic original message','2026-05-01');
 UPDATE public.meta_message_phone_candidates SET source_event_ids=ARRAY['00000000-0000-4000-8000-000000000004'::uuid] WHERE id=1;
 INSERT INTO public.messenger_attribution_touches(psid,page_id,touched_at,campaign_name,ad_id) VALUES('s1','p1','2026-05-01','Synthetic campaign','test-ad');`)
 await reject(readCase('meta',null,agent),/administrator/)
 await reject(readCase('meta',null,inactive),/administrator/)
 await db.exec(`SET request.jwt.claim.role='authenticated'`)
 await reject(readCase('meta',null),/administrator/)
 await reject(resolve('revenue',1,{action:'needs_review',reason:notes}),/administrator/)
 await db.exec(`SET request.jwt.claim.role='service_role'`)
 check((await readCase('meta',null)).open===2,'open queue')
 check((await readCase('leads',null,actor,0,'','Synthetic')).length===2,'bounded lead search')
 check((await readCase('leads',null,actor,0,'',"%' OR true --")).length===0,'search text is not SQL')
 await reject(readCase('meta',null,actor,-1),/Invalid review query/)
 check((await readCase('meta',1)).messages[0].native_inbound===false,'historical projected direction is not native proof')
 const source = {action:'verify_source',reason:notes,evidenceReference:'Synthetic original registration #1',source:'facebook',eventDate:'2026-05-01',attested:true,verifiedHn:'H1',excludedEvidence:[]}
 await reject(resolve('revenue',1,{...source,attested:false}),/Verify the original/)
 await reject(resolve('revenue',1,{...source,verifiedHn:'H2'}),/hospital number/)
 await reject(resolve('revenue',1,{...source,eventDate:'2099-01-01'}),/Verify the original/)
 await reject(resolve('revenue',1,{...source,excludedEvidence:[{table:'crm_leads',id:'2'}]}),/does not belong/)
 await reject(resolve('revenue',1,{...source,source:'invented-ad'}),/Verify the original/)
 const oldVersion = await version('revenue',1), requestId=randomUUID()
 const result = await resolve('revenue',1,source,{version:oldVersion,requestId})
 check(result.sourceRevision>0 && !result.pipeline.inWindow && !result.pipeline.current,'outside-window correction durably queued')
 check((await resolve('revenue',1,source,{version:oldVersion,requestId})).replayed,'retry idempotent after version changed')
 await reject(resolve('revenue',1,{...source,reason:notes+' different'},{version:oldVersion,requestId}),/already used/)
 await reject(resolve('revenue',1,source,{version:oldVersion}),/case changed/)
 await db.query('SELECT mis_internal.rebuild_marketing_patients($1)',[[1]])
 check((await scalar('SELECT attribution_status FROM public.patient_marketing_attribution WHERE patient_id=1')).attribution_status==='eligible_source','source correction flows through real marketing rules')
 check(Number((await scalar('SELECT sum(net_bill) n FROM public.invoices')).n)===300,'financial totals unchanged')
 const sourceDetail = await readCase('revenue',1)
 check(sourceDetail.history.length===1 && !sourceDetail.history[0].reconciled,'per-correction reconciliation status')
 check(sourceDetail.originalRecords.items[0].fields['Source system']==='app','review includes bounded original source records')
 await reject(db.query('SELECT mis_internal.marketing_review_original_records($1,1,0)',[agent]),/administrator/)
 await reject(db.exec('DELETE FROM mis_internal.marketing_review_actions'),/immutable/i)
 await reject(db.exec('UPDATE mis_internal.marketing_review_source_versions SET active=false'),/immutable/i)
 await resolve('revenue',1,{action:'retract_source',reason:notes})
 await db.query('SELECT mis_internal.rebuild_marketing_patients($1)',[[1]])
 check((await scalar('SELECT attribution_status FROM public.patient_marketing_attribution WHERE patient_id=1')).attribution_status==='unknown_source','retraction restores original source rules')
 await resolve('revenue',1,{...source,eventDate:'2026-07-01',excludedEvidence:[{table:'crm_leads',id:'1'}]})
 await db.query('SELECT mis_internal.rebuild_marketing_patients($1)',[[1]])
 check((await scalar('SELECT attribution_status FROM public.patient_marketing_attribution WHERE patient_id=1')).attribution_status==='late_source','late manual evidence cannot acquire historical revenue')
 await db.exec(`UPDATE public.crm_leads SET source='google',created_at='2026-04-01' WHERE id=2`)
 await resolve('revenue',2,{...source,verifiedHn:'H2',excludedEvidence:[{table:'crm_leads',id:'2'}]})
 await db.exec(`INSERT INTO public.lead_attribution(lead_id,patient_id,source_category,first_touch_date,attribution_confidence,attribution_level) VALUES(2,2,'google','2026-04-01',0.85,'self_reported')`)
 await db.query('SELECT mis_internal.rebuild_marketing_patients($1)',[[2]])
 check((await scalar('SELECT validated_source FROM public.patient_marketing_attribution WHERE patient_id=2')).validated_source==='facebook','later derived attribution cannot resurrect an excluded source')
 const matches = (await readCase('meta',1)).matches
 const confirm = {action:'confirm',reason:notes,evidenceReference:'Recorded independent identity verification #1',attested:true,verifiedHn:'H1',leadId:1,leadVersion:matches.find(x=>x.id===1).version}
 await reject(resolve('meta',1,{...confirm,attested:false}),/Verified identity/)
 await reject(resolve('meta',1,{...confirm,verifiedHn:'H2'}),/hospital number/)
 await reject(resolve('meta',1,{...confirm,leadVersion:'old'}),/lead changed/)
 await resolve('meta',1,confirm)
 check((await scalar('SELECT converted_crm_lead_id id FROM public.messenger_contacts WHERE id=1')).id===1,'verified identity linked')
 check((await scalar(`SELECT count(*) n FROM mis_internal.marketing_source_evidence_v2 WHERE patient_id=1 AND evidence_table='messenger_attribution_touches' AND authenticated`)).n===1,'verified Meta evidence available to downstream rules')
 const lead2=(await readCase('meta',2)).matches.find(l=>l.id===2) || (await readCase('leads',null,actor,0,'','H2'))[0]
 await reject(resolve('meta',2,{...confirm,leadId:2,leadVersion:lead2.version,verifiedHn:'H2'}),/another verified CRM link/)
 await resolve('meta',1,{action:'reopen',reason:notes})
 check((await scalar('SELECT converted_crm_lead_id id FROM public.messenger_contacts WHERE id=1')).id===null,'reopen unlinks owned contact')
 check((await scalar(`SELECT count(*) n FROM mis_internal.marketing_source_evidence_v2 WHERE evidence_table='messenger_attribution_touches' AND authenticated`)).n===0,'reopen retracts Meta source evidence')
 const staleMeta=await version('meta',1)
 await db.exec(`INSERT INTO public.messenger_events(psid,page_id,message_text) VALUES('s1','p1','New evidence from another reviewer session')`)
 await reject(resolve('meta',1,{action:'needs_review',reason:notes},{version:staleMeta}),/case changed/)
 const rv=(await scalar('SELECT revision FROM mis_internal.marketing_reconciliation_state')).revision
 await db.exec(`INSERT INTO mis_internal.mis_gateway_batches VALUES(1);
 INSERT INTO mis_internal.shadow_attribution_runs VALUES(1,'completed',true,'source_evidence_v2');
 INSERT INTO mis_internal.shadow_patient_acquisitions VALUES(1,'2026-06-01',null,null,1);
 INSERT INTO mis_internal.shadow_invoice_attribution VALUES(1,1,'2026-06-01',null,'missing_source',100,1);
 INSERT INTO mis_internal.mis_gateway_publication VALUES(true,'complete',${rv},'marketing_pipeline_v2',1,1);
 SELECT mis_internal.refresh_marketing_review_snapshot();`)
 check((await readCase('revenue',null)).netBill===100,'stable revenue queue seeded from validated publication')
 await db.exec(`UPDATE mis_internal.mis_gateway_publication SET stage='lifetime'; DELETE FROM mis_internal.shadow_invoice_attribution`)
 check((await readCase('revenue',null)).netBill===100,'staged cache clear never wipes review queue')
 await db.exec(`INSERT INTO mis_internal.shadow_invoice_attribution VALUES(1,1,'2026-06-01','facebook','eligible_source',100,1); UPDATE mis_internal.mis_gateway_publication SET stage='complete'`)
 // A new completed run is required to replace a previously captured generation.
 await db.exec(`INSERT INTO mis_internal.shadow_attribution_runs VALUES(2,'completed',true,'source_evidence_v2');
 UPDATE mis_internal.shadow_invoice_attribution SET run_id=2; UPDATE mis_internal.shadow_patient_acquisitions SET run_id=2;
 UPDATE mis_internal.mis_gateway_publication SET stage='complete'`)
 check((await readCase('revenue',null)).total===0,'resolved revenue exits queue at next validated publication')
 const privileges=await scalar(`SELECT has_function_privilege('anon','public.marketing_review_read(uuid,text,bigint,integer,text,text)','EXECUTE') a,
 has_function_privilege('authenticated','public.marketing_review_resolve(uuid,uuid,text,bigint,text,jsonb)','EXECUTE') b,
 has_table_privilege('service_role','mis_internal.marketing_review_actions','SELECT') c`)
 check(!privileges.a && !privileges.b && !privileges.c,'RPC grants and private audit deny direct access')
 console.log(`PASS: ${tests} synthetic administrator review scenarios (no production data).`)
} finally { await db.close() }

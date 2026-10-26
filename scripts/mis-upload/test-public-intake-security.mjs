import {readFile,readdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
const root=new URL('../../',import.meta.url)
const db=new PGlite()
try {
 await db.exec(`CREATE ROLE anon; GRANT USAGE ON SCHEMA public TO anon;
 CREATE TABLE public.crm_appointments(source_system text,appointment_status text,confirmation_status text,appointment_date date,patient_id integer,visit_verified boolean DEFAULT false,visit_verified_at timestamptz,visit_verified_by text,matched_invoice_id bigint,original_status_before_invoice text);
 CREATE TABLE public.crm_leads(source_system text,lead_status text,patient_id integer,conversion_verified boolean DEFAULT false,conversion_verified_at timestamptz,validated_meta_ad_id text);
 ALTER TABLE public.crm_appointments ENABLE ROW LEVEL SECURITY; ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;
 GRANT INSERT ON public.crm_appointments,public.crm_leads TO anon;
 CREATE POLICY public_website_booking_insert ON public.crm_appointments FOR INSERT TO anon WITH CHECK(source_system='website');
 CREATE POLICY public_website_interest_insert ON public.crm_leads FOR INSERT TO anon WITH CHECK(source_system='website');`)
 const migration=(await readdir(new URL('supabase/migrations/',root))).find(f=>f.endsWith('_protect_public_intake_evidence.sql'))
 await db.exec(await readFile(new URL('supabase/migrations/'+migration,root),'utf8'))
 await db.exec('SET ROLE anon')
 const appointment=(field='',value='')=>`INSERT INTO public.crm_appointments(source_system,appointment_status,confirmation_status,appointment_date${field?','+field:''}) VALUES('website','Pending','Not Confirmed',current_date${value?','+value:''})`
 const lead=(field='',value='')=>`INSERT INTO public.crm_leads(source_system,lead_status${field?','+field:''}) VALUES('website','Website Appointment Made'${value?','+value:''})`
 await db.exec(appointment());await db.exec(lead())
 for(const [field,value] of [['patient_id','123'],['visit_verified','true'],['visit_verified_at','now()'],['visit_verified_by',"'forged'"],['matched_invoice_id','456'],['original_status_before_invoice',"'Completed'"]])
  await assert.rejects(db.exec(appointment(field,value)),/row-level security/)
 for(const [field,value] of [['patient_id','123'],['conversion_verified','true'],['conversion_verified_at','now()'],['validated_meta_ad_id',"'forged'"]])
  await assert.rejects(db.exec(lead(field,value)),/row-level security/)
 await assert.rejects(db.exec('SELECT * FROM public.crm_leads'),/permission denied/)
 await db.exec('RESET ROLE')
 assert.equal((await db.query('SELECT count(*)::int n FROM public.crm_appointments')).rows[0].n,1)
 assert.equal((await db.query('SELECT count(*)::int n FROM public.crm_leads')).rows[0].n,1)
 console.log('Public intake security passed: normal requests accepted; forged identity, invoice, conversion and ad evidence rejected; anonymous reads denied.')
} finally {await db.close()}

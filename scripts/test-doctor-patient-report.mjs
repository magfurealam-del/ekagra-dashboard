import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite()
const migration=await readFile(new URL('../supabase/migrations/20261030133624_doctor_patient_report.sql',import.meta.url),'utf8')
const read=async(start='2026-10-01',end='2026-10-31')=>(await db.query('SELECT get_doctor_patient_report($1,$2) r',[start,end])).rows[0].r
try {
  await db.exec(`CREATE SCHEMA auth;CREATE SCHEMA mis_internal;CREATE ROLE anon;CREATE ROLE authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
    SET test.uid='00000000-0000-0000-0000-000000000001';`)
  await db.exec(await readFile(new URL('./dashboard-test-schema.sql',import.meta.url),'utf8'))
  await db.exec(`CREATE TABLE doctors(id int PRIMARY KEY,name text);
    CREATE FUNCTION resolve_booking_doctor(text) RETURNS text LANGUAGE sql AS $$SELECT CASE WHEN $1 IN ('Dr Example','Dr. Example','Dr Example — Consultation') THEN 'Dr. Example' END$$;
    CREATE TABLE crm_call_interactions(id bigint,patient_id int,lead_id bigint,appointment_id bigint,call_outcome text,call_started_at timestamptz,created_at timestamptz,phone_normalized text,agent_name text);
    INSERT INTO user_profiles(id,role,is_active) VALUES(auth.uid(),'admin',true);
    INSERT INTO patients(id,full_name,phone_e164) VALUES(1,'Synthetic patient','+8801000000000');
    INSERT INTO crm_leads(id,patient_id,lead_name,created_at,preferred_doctor) VALUES(1,1,'Synthetic lead','2026-09-30T18:00:00Z','Dr Example'),(2,NULL,'Unlinked lead','2026-10-01',NULL);
    INSERT INTO crm_appointments(id,patient_id,lead_id,doctor_service,appointment_date,appointment_status,confirmation_status) VALUES
      (1,1,1,'Dr Example','2026-10-01','Booked','Confirmed'),
      (2,1,1,'Dr. Example','2026-10-02','Completed','Confirmed'),
      (3,1,1,'Dr Example — Consultation','2026-10-03','No-show','Confirmed'),
      (4,1,1,'Dr. Example','2026-10-04','Rescheduled','Confirmed'),
      (5,1,1,'Dr. Example','2026-10-31','Scheduled','Not Confirmed'),
      (6,1,1,'Dr. Example','2026-10-05','Cancelled','Confirmed'),
      (7,1,1,'Dr. Example','2026-11-01','Booked','Not Confirmed'),
      (8,NULL,NULL,NULL,'2026-10-06',NULL,NULL);
    UPDATE crm_appointments SET rescheduled_to_appointment_id=7 WHERE id=4;
    UPDATE crm_appointments SET previous_appointment_id=4 WHERE id=7;
    INSERT INTO crm_call_interactions(id,lead_id,call_outcome,call_started_at) VALUES
      (1,1,'not_interested','2026-09-30T18:00:00Z'),
      (2,1,'not_interested','2026-10-02T18:00:00Z'),
      (3,2,'not_interested','2026-10-31T17:59:59Z'),
      (4,2,'not_interested','2026-10-31T18:00:00Z');
    INSERT INTO outgoing_call_queue(id,patient_id,source_table,source_id) VALUES(1,1,'validated_appointments','3');
    INSERT INTO outgoing_call_attempts(id,queue_id,outcome_code,called_at) VALUES(1,1,'not_interested','2026-10-04');
    INSERT INTO crm_leads(id,lead_name,lead_status,created_at) VALUES(3,'Legacy','Not Interested','2026-10-06');`)
  await db.exec(migration)
  let r=await read()
  assert.equal(r.records.filter(x=>x.kind==='appointment').length,7)
  assert.equal(r.records.find(x=>x.appointment_id===1).status,'Confirmed')
  for (const [id,status] of [[2,'Completed'],[3,'No-show'],[4,'Rescheduled'],[5,'Booked'],[6,'Cancelled'],[8,'Other']]) assert.equal(r.records.find(x=>x.appointment_id===id).status,status)
  assert.equal(r.records.find(x=>x.appointment_id===4).replacement_date,'2026-11-01')
  assert.equal(r.records.find(x=>x.appointment_id===3).doctor,'Dr. Example')
  assert.equal(r.records.find(x=>x.appointment_id===8).doctor,'Doctor not recorded')
  const declines=r.records.filter(x=>x.kind==='not_interested')
  assert.equal(declines.length,3,'repeat declines for explicitly linked person and doctor collapse')
  assert.ok(declines.some(x=>x.record_id==='outbound:1' && x.doctor==='Dr. Example'))
  assert.ok(declines.some(x=>x.record_id==='call:3' && x.report_date==='2026-10-31'))
  assert.ok(declines.some(x=>x.record_id==='lead:3' && x.date_basis.includes('outcome date unavailable')))
  assert.equal((await read('2000-01-01','2000-01-31')).records.length,0)
  await assert.rejects(()=>read('2026-10-31','2026-10-01'),/valid period/)
  await assert.rejects(()=>read('2020-01-01','2026-10-31'),/366/)
  await db.exec("UPDATE user_profiles SET role='call_center_agent'")
  await assert.rejects(()=>read(),/administrator/)
  await db.exec("UPDATE user_profiles SET role='admin',is_active=false")
  await assert.rejects(()=>read(),/administrator/)
  await db.exec("UPDATE user_profiles SET is_active=true;SET test.uid=''")
  await assert.rejects(()=>read(),/administrator/)
  const security=(await db.query("SELECT prosecdef,has_function_privilege('anon','get_doctor_patient_report(date,date)','execute') anon FROM pg_proc WHERE proname='get_doctor_patient_report'")).rows[0]
  assert.equal(security.prosecdef,false);assert.equal(security.anon,false)
  console.log('Doctor patient SQL tests passed: statuses, confirmations, reschedule chains, canonical names, date boundaries, decline deduplication, legacy evidence, empty periods and administrator authorization.')
} finally {await db.close()}

import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite()
const migration=await readFile(new URL('../supabase/migrations/20261030133624_doctor_patient_report.sql',import.meta.url),'utf8')
let reportFunction='get_doctor_patient_report'
const read=async(start='2026-10-01',end='2026-10-31')=>(await db.query(`SELECT ${reportFunction}($1,$2) r`,[start,end])).rows[0].r
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
  const original=await read()
  await db.exec(await readFile(new URL('../supabase/migrations/20261030134641_doctor_patient_report_performance.sql',import.meta.url),'utf8'))
  assert.deepEqual((await read()).records,original.records,'performance changes preserve every report record')
  await db.exec(await readFile(new URL('../supabase/migrations/20261030134936_doctor_patient_report_source_reads.sql',import.meta.url),'utf8'))
  assert.deepEqual((await read()).records,original.records,'source materialization preserves every report record')
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
  await db.exec(`CREATE TABLE invoice_line_items(invoice_id bigint,category_name text,item_type text,particulars text,needs_review boolean);
    INSERT INTO invoices(id,invoice_no,patient_id,invoice_date,consultant_name_raw,source_system,invoice_status,reconciliation_status,needs_review,net_bill,total_refund,invoice_type)
    VALUES(100,'TEST-MIS-100',1,'2026-10-02','Dr Example','mis_report','final','matched',false,500,0,'opd');
    INSERT INTO invoice_line_items VALUES(100,'OPD SERVICES','service','Consultation',false);
    UPDATE crm_appointments SET visit_verified=true,matched_invoice_id=999 WHERE id=3;`)
  await db.exec(await readFile(new URL('../supabase/migrations/20261030140111_doctor_patient_mis_visit_evidence.sql',import.meta.url),'utf8'))
  reportFunction='get_doctor_patient_report_v2'
  const originalMis=(await read()).records
  await db.exec(await readFile(new URL('../supabase/migrations/20261030140855_doctor_patient_mis_evidence_reads.sql',import.meta.url),'utf8'))
  assert.deepEqual((await read()).records,originalMis,'MIS source optimization preserves all evidence')
  const appointment=async id=>(await read()).records.find(r=>r.appointment_id===id)
  r=await read()
  assert.equal(r.version,2)
  assert.equal(r.mis_coverage.latest_invoice_date,'2026-10-02')
  assert.equal((await appointment(1)).status,'Booked','a phone response never confirms a completed visit')
  assert.equal((await appointment(2)).status,'Confirmed visit')
  assert.equal((await appointment(2)).mis_invoices[0].number,'TEST-MIS-100')
  assert.equal((await appointment(3)).mis_visit_confirmed,false,'legacy flags alone are not evidence')
  assert.equal((await appointment(5)).status,'Booked')
  assert.equal((await appointment(2)).pre_visit_response,'Response recorded')
  for(const [column,bad,good] of [
    ['patient_id',2,1],['invoice_date','2026-10-01','2026-10-02'],
    ['consultant_name_raw','Unrelated doctor','Dr Example'],['source_system','manual','mis_report'],
    ['invoice_status','void','final'],['reconciliation_status','unmatched','matched'],
    ['needs_review',true,false],['net_bill',0,500],['total_refund',500,0],
    ['invoice_type','pharmacy','opd'],['invoice_type','pathology','opd'],['invoice_type','refund','opd'],
  ]) {
    await db.query(`UPDATE invoices SET ${column}=$1 WHERE id=100`,[bad])
    const row=await appointment(2)
    assert.equal(row.mis_visit_confirmed,false,column)
    assert.equal(row.status,'Completion reported',column)
    assert.deepEqual(row.mis_invoices,[],column)
    await db.query(`UPDATE invoices SET ${column}=$1 WHERE id=100`,[good])
  }
  await db.exec("UPDATE invoice_line_items SET category_name='PHARMACY',item_type='medicine',particulars='Medicine'")
  assert.equal((await appointment(2)).mis_visit_confirmed,false,'pharmacy-only invoice lines do not prove a doctor visit')
  await db.exec("UPDATE invoice_line_items SET category_name='OPD SERVICES',item_type='service',particulars='Consultation',needs_review=true")
  assert.equal((await appointment(2)).mis_visit_confirmed,false,'unreviewed clinical evidence is rejected')
  await db.exec("UPDATE invoice_line_items SET needs_review=false")
  for(const status of ['Booked','No-show','Cancelled','Rescheduled']) {
    await db.query('UPDATE crm_appointments SET appointment_status=$1 WHERE id=2',[status])
    assert.equal((await appointment(2)).status,'Review required','invoice versus CRM outcome conflict')
  }
  await db.exec("UPDATE crm_appointments SET appointment_status='Completed' WHERE id=2; INSERT INTO crm_appointments(id,patient_id,doctor_service,appointment_date,appointment_status) VALUES(99,1,'Dr. Example','2026-10-02','Completed')")
  assert.equal((await appointment(2)).status,'Review required','one encounter cannot prove multiple appointment records')
  assert.equal((await appointment(99)).mis_visit_confirmed,false)
  await db.exec("DELETE FROM crm_appointments WHERE id=99; UPDATE crm_leads SET patient_id=2 WHERE id=1")
  assert.equal((await appointment(2)).status,'Review required','conflicting linked identities are rejected')
  await db.exec("UPDATE crm_leads SET patient_id=1 WHERE id=1")
  assert.equal((await appointment(2)).status,'Confirmed visit')
  await db.exec("UPDATE user_profiles SET role='call_center_agent'")
  await assert.rejects(()=>read(),/administrator/)
  await db.exec("UPDATE user_profiles SET role='admin',is_active=false")
  await assert.rejects(()=>read(),/administrator/)
  await db.exec("UPDATE user_profiles SET is_active=true;SET test.uid=''")
  await assert.rejects(()=>read(),/administrator/)
  const security=(await db.query("SELECT prosecdef,has_function_privilege('anon','get_doctor_patient_report_v2(date,date)','execute') anon FROM pg_proc WHERE proname='get_doctor_patient_report_v2'")).rows[0]
  assert.equal(security.prosecdef,false);assert.equal(security.anon,false)
  console.log('Doctor patient SQL tests passed: statuses, confirmations, reschedule chains, canonical names, date boundaries, decline deduplication, legacy evidence, empty periods and administrator authorization.')
} finally {await db.close()}

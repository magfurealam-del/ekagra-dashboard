import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite()
const rows=async(sql,args=[])=>(await db.query(sql,args)).rows
const value=async(sql,args=[])=>(await rows(sql,args))[0].value
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT CASE WHEN current_setting('test.auth',true)='false' THEN NULL ELSE '00000000-0000-0000-0000-000000000001'::uuid END$$;
 CREATE FUNCTION is_active_staff() RETURNS boolean LANGUAGE sql AS $$SELECT coalesce(current_setting('test.staff',true),'true')='true'$$;
 CREATE FUNCTION is_admin() RETURNS boolean LANGUAGE sql AS $$SELECT coalesce(current_setting('test.admin',true),'true')='true'$$;
 CREATE FUNCTION current_agent_label() RETURNS text LANGUAGE sql AS $$SELECT 'test admin'$$;
 CREATE TABLE doctors(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,name text,is_active boolean DEFAULT true);
 INSERT INTO doctors(name) VALUES ('Dr. Example'),('Dr Example'),('Dr. Unscheduled'),('Dr. Paused'),('Dr. Md. Bari Khandakar'),('Dr. Md. Abdul Bari Khandakar'),('Dr. Ejaj Bari Choudhury'),('Dr. MD. Ejaj Bari Choudhury'),('Dr. As-Ad Din Mahmood Asad'),('Dr. As-Ad Din Mahmood'),('Dr. Hasan Khalid MD. Monir'),('Dr. Hasan Khalid Md. Munir'),('Dr. Muhammad Nazmul Hassan'),('Dr. Muhammad Nazmul Hassan,'),('Dr. Rakibul Hasan Apu'),('Dr Rakibul Hasan Apu'),('Screening Only');
 CREATE TABLE doctor_schedules(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,doctor_name text NOT NULL,day_of_week smallint NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),start_time time NOT NULL,end_time time NOT NULL,slot_minutes smallint DEFAULT 15,is_active boolean DEFAULT true,CONSTRAINT doctor_schedules_doctor_day_unique UNIQUE(doctor_name,day_of_week));
 INSERT INTO doctor_schedules(doctor_name,day_of_week,start_time,end_time,is_active) VALUES('Dr. Example',0,'14:00','16:00',true),('Dr. Paused',0,'09:00','17:00',false),('Screening Only',0,'09:00','21:00',true);
 CREATE TABLE doctor_daily_availability(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,doctor_name text,avail_date date,is_available boolean,start_time time,end_time time,note text,updated_by text,updated_at timestamptz,UNIQUE(doctor_name,avail_date));
 CREATE TABLE doctor_availability_audit(doctor_name text,avail_date date,action text,is_available boolean,start_time time,end_time time,note text,changed_by text);
 CREATE TABLE sync_audit_log(source_system text,table_name text,operation text,internal_id text,status text,payload jsonb);
 CREATE TABLE crm_appointments(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,patient_id integer,lead_id bigint,appointment_date date,appointment_time text,doctor_service text,doctor_id integer,appointment_type text,appointment_status text,confirmation_status text,no_show_risk text,notes text,previous_appointment_id bigint,rescheduled_to_appointment_id bigint,source_system text,updated_at timestamptz);
 `)
 for(const file of ['20261027121952_doctor_multiple_sessions.sql','20261027124621_doctor_registry_booking_consistency.sql','20261027133315_doctor_booking_write_guards.sql','20261027133317_doctor_booking_rpc_consistency.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'))
 const slots=name=>rows("SELECT public.doctor_booking_slots($1,'2026-11-01') slot",[name]).then(r=>r.map(x=>x.slot))
 const context=name=>value("SELECT public.get_doctor_booking_context($1,'2026-11-01') value",[name])
 assert.equal((await context('Unknown')).status,'unknown_doctor')
 assert.equal((await context('Dr. Unscheduled')).status,'schedule_missing')
 assert.equal((await context('Dr. Paused')).status,'schedule_paused')
 const aliases=[['Dr. Md. Abdul Bari Khandakar','Dr. Md. Bari Khandakar'],['Dr. MD. Ejaj Bari Choudhury','Dr. Ejaj Bari Choudhury'],['Dr. As-Ad Din Mahmood','Dr. As-Ad Din Mahmood Asad'],['Dr. Hasan Khalid Md. Munir','Dr. Hasan Khalid MD. Monir'],['Dr. Muhammad Nazmul Hassan,','Dr. Muhammad Nazmul Hassan'],['Dr Rakibul Hasan Apu','Dr. Rakibul Hasan Apu']]
 for(const [alias,canonical] of aliases){
  assert.equal(await value('SELECT public.resolve_booking_doctor($1) value',[alias+' — Consultation']),canonical)
  await db.query('SELECT public.bulk_upsert_doctor_schedules($1)',[JSON.stringify([{doctor_name:alias,day_of_week:0,start_time:'14:00',end_time:'16:00'},{doctor_name:alias,day_of_week:0,start_time:'18:00',end_time:'20:00'}])])
  assert.deepEqual(await slots(alias),await slots(canonical));assert.equal((await slots(alias)).length,16)
 }
 assert.equal((await value('SELECT public.get_doctor_booking_directory() value')).length,10,'six explicit aliases and one formatting duplicate collapse')
 await db.exec("INSERT INTO doctor_schedules(doctor_name,day_of_week,start_time,end_time) VALUES('Dr. Example',0,'18:00','20:00')")
 assert.equal((await slots('dr example — Consultation')).length,16)
 await assert.rejects(()=>db.exec("INSERT INTO doctor_schedules(doctor_name,day_of_week,start_time,end_time) VALUES('Dr Example',0,'15:00','17:00')"),/overlap/)
 await db.exec("SELECT set_doctor_daily_availability('Dr Example','2026-11-01',true,'14:07','18:40')")
 assert.deepEqual(await slots('Dr. Example'),['14:15','14:30','14:45','15:00','15:15','15:30','15:45','18:00','18:15'],'clipping preserves the original slot grid and session breaks')
 await assert.rejects(()=>db.exec("SELECT set_doctor_daily_availability('Dr Example','2026-11-01',true,'16:00','18:00')"),/no full/)
 await assert.rejects(()=>db.exec("SELECT set_doctor_daily_availability('Dr Example','2026-11-01',true,'18:00',NULL)"),/both/)
 await assert.rejects(()=>db.exec("SELECT set_doctor_daily_availability('Dr. Unscheduled','2026-11-01',true,NULL,NULL)"),/weekly/)
 await db.exec("SELECT set_doctor_daily_availability('Dr Example','2026-11-01',false,NULL,NULL)")
 assert.deepEqual(await slots('Dr. Example'),[])
 await db.exec("SELECT clear_doctor_daily_availability('dr example','2026-11-01')")
 assert.equal((await slots('Dr. Example')).length,16)
 const book=(name,time,source='app')=>db.query("INSERT INTO crm_appointments(doctor_service,appointment_date,appointment_time,source_system,appointment_status) VALUES($1,'2026-11-01',$2,$3,'Booked') RETURNING id",[name,time,source])
 for(const time of ['16:00','17:00','20:00','14:07','garbage'])await assert.rejects(()=>book('Dr. Example',time),/outside/)
 await assert.rejects(()=>book('Unknown','14:00'),/recognized/)
 const appt=(await book('Dr Example — Consultation','14:00','outgoing_call_queue')).rows[0].id
 assert.equal((await context('Dr. Example')).days[0].appointment_count,1,'suffix aliases counted together')
 await assert.rejects(()=>db.query("SELECT reschedule_appointment($1,'2026-11-01','17:00')",[appt]),/outside/)
 assert.equal(await value('SELECT appointment_status value FROM crm_appointments WHERE id=$1',[appt]),'Booked','failed reschedule rolls back old status')
 await db.query("SELECT reschedule_appointment($1,'2026-11-01','18:00')",[appt])
 await assert.rejects(()=>db.query("SELECT reschedule_appointment($1,'2026-11-01','18:15')",[appt]),/already/)
 assert.equal((await context('Dr. Example')).days[0].appointment_count,1,'rescheduled originals excluded')
 await book('Unmapped imported doctor','17:00','legacy_import')
 await db.exec("SET test.auth='false'")
 await assert.rejects(()=>context('Dr. Example'),/staff/)
 await assert.rejects(()=>value('SELECT get_doctor_booking_directory() value'),/staff/)
 await db.exec("SET test.auth='true';SET test.staff='false'")
 await assert.rejects(()=>context('Dr. Example'),/staff/)
 console.log('Booking audit tests passed: all confirmed aliases, canonical directory, missing/paused schedules, split sessions, grid alignment, overrides, all interactive writes, failed reschedule rollback, repeated reschedule protection and staff authorization.')
}finally{await db.close()}

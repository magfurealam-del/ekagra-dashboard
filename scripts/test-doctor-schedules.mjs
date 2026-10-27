import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
const db = new PGlite()
try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
 CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('test.admin',true)='true'$$;
 CREATE FUNCTION public.current_agent_label() RETURNS text LANGUAGE sql AS $$SELECT 'test admin'$$;
 CREATE TABLE doctors(name text,is_active boolean);
 INSERT INTO doctors VALUES('Dr. Example',true),('Dr Example',true),('Dr. Other',true);
 CREATE TABLE doctor_schedules(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,doctor_name text NOT NULL,day_of_week smallint NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),start_time time NOT NULL,end_time time NOT NULL,slot_minutes smallint DEFAULT 15,is_active boolean DEFAULT true,CONSTRAINT doctor_schedules_doctor_day_unique UNIQUE(doctor_name,day_of_week));
 INSERT INTO doctor_schedules(doctor_name,day_of_week,start_time,end_time) VALUES('Dr. Example',0,'14:00','20:00'),('Dr. Example',1,'14:00','16:00'),('Dr. Other',0,'09:00','12:00');
 CREATE TABLE sync_audit_log(source_system text,table_name text,operation text,internal_id text,status text,payload jsonb);
 SET test.admin='true';`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261027121952_doctor_multiple_sessions.sql',import.meta.url),'utf8'))
 const session=(start,end,day=0)=>({doctor_name:'Dr Example',day_of_week:day,start_time:start,end_time:end,slot_minutes:15,is_active:true})
 const save=rows=>db.query('SELECT public.bulk_upsert_doctor_schedules($1::jsonb) result',[JSON.stringify(rows)])
 const snapshot=async()=>(await db.query('SELECT * FROM doctor_schedules ORDER BY id')).rows
 await save([session('14:00','16:00'),session('18:00','20:00')])
 let rows=await snapshot()
 assert.equal(rows.length,4)
 assert.equal(rows.filter(r=>r.doctor_name==='Dr. Example'&&r.day_of_week===0).length,2)
 assert.equal(rows.filter(r=>r.doctor_name==='Dr Example').length,0)
 const before=await snapshot()
 for (const invalid of [
  [session('14:00','18:01'),session('18:00','20:00')],
  [session('14:00','18:01','00'),session('18:00','20:00',0)],
  [session('16:00','14:00')], [session('14:00','24:00')],
  [{...session('14:00','16:00'),slot_minutes:0}],
  [{...session('14:00','16:00'),doctor_name:'Unknown'}],
  [{...session('14:00','16:00'),is_active:false},session('18:00','20:00')],
 ]) { await assert.rejects(()=>save(invalid)); assert.deepEqual(await snapshot(),before,'failed updates must preserve the old schedule') }
 await db.exec("SET test.admin='false'")
 await assert.rejects(()=>save([session('14:00','16:00')]),/Only admins/)
 assert.deepEqual(await snapshot(),before)
 await db.exec("SET test.admin='true'")
 await save([session('14:00','16:00'),session('18:00','20:00')])
 assert.equal((await snapshot()).length,4,'repeated saves replace sessions, not duplicate them')
 await save([{...session('09:00','21:00'),is_active:false}])
 rows=await snapshot();assert.equal(rows.filter(r=>r.day_of_week===0&&r.doctor_name==='Dr. Example'&&r.is_active).length,0)
 assert.equal(rows.filter(r=>r.doctor_name==='Dr. Other').length,1)
 const audit=(await db.query('SELECT payload FROM sync_audit_log')).rows
 assert.equal(audit.length,3);assert.equal(audit[0].payload.before.length,1);assert.equal(audit[0].payload.after.length,2)
 console.log('Doctor schedule SQL tests passed: multi-session replacement, aliases, validation, atomic rollback, admin access, OFF days and audit history.')
} finally {await db.close()}

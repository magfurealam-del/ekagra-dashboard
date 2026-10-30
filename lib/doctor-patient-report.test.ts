import {test} from 'node:test'
import assert from 'node:assert/strict'
import {summarizeDoctorPatients,filterDoctorPatients,doctorReportCsv,type DoctorPatientRecord} from './doctor-patient-report.ts'
const record=(changes:Partial<DoctorPatientRecord>):DoctorPatientRecord=>({record_id:'appointment:1',kind:'appointment',doctor:'Dr. Example',raw_doctor:'Dr Example',identity_key:'patient:1',patient_id:1,lead_id:1,patient_name:'Synthetic patient',phone:'+8801000000000',hospital_patient_id:'H001',hn:null,area:null,report_date:'2026-10-01',date_basis:'Appointment date',recorded_at:null,status:'Completed',agent:'Test',evidence:'CRM appointment',...changes})
test('repeat appointments and declines do not inflate distinct identity totals',()=>{
  const rows=[record({}),record({record_id:'appointment:2',status:'Rescheduled'}),record({record_id:'call:1',kind:'not_interested',status:'Not interested'})]
  const summary=summarizeDoctorPatients(rows)
  assert.equal(summary.total,2);assert.equal(summary.patients,1);assert.equal(summary.declined,1)
  assert.equal(Object.values(summary.counts).reduce((a,b)=>a+b,0),summary.total)
  assert.equal(filterDoctorPatients(rows,'Dr. Example','Not interested','h001').length,1)
  assert.equal(filterDoctorPatients(rows,'Dr. Other','','').length,0)
  assert.equal(filterDoctorPatients(rows,'','Completed','synthetic').length,1)
  assert.equal(filterDoctorPatients(rows,'','Not interested','call:1').length,1)
  assert.equal(filterDoctorPatients(rows,'','','').length,2)
})
test('CSV includes complete evidence and neutralizes spreadsheet formulas',()=>{
  const csv=doctorReportCsv([record({patient_name:'=HYPERLINK("bad")',rescheduled_to_appointment_id:2,replacement_date:'2026-11-01'})])
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));assert.ok(csv.includes('"\'+8801000000000"'));assert.ok(csv.includes('"2026-11-01"'))
})

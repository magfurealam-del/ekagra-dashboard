import test from 'node:test'
import assert from 'node:assert/strict'
import { doctorSlots, parseScheduleCell, parseScheduleCsv, scheduleCell, sessionValidation, uniqueDoctorNames, doctorNameVariants } from './doctor-schedule.ts'

const sunday = parseScheduleCell('14:00-16:00;18:00-20:00', 0)
test('split sessions expose both sessions, never the break or closing time', () => {
  const slots = doctorSlots(sunday, '2026-11-01')
  assert.equal(slots.length, 16)
  assert.equal(slots[0], '14:00'); assert.equal(slots.at(-1), '19:45')
  assert.ok(slots.includes('18:00')); assert.ok(!slots.includes('16:00')); assert.ok(!slots.includes('17:00')); assert.ok(!slots.includes('20:00'))
  assert.equal(doctorSlots(sunday, '2026-11-02').length, 0)
})
test('unavailable days and reduced hours preserve breaks', () => {
  assert.deepEqual(doctorSlots(sunday, '2026-11-01', {is_available:false}), [])
  assert.deepEqual(doctorSlots(sunday, '2026-11-01', {is_available:true,start_time:'15:30',end_time:'18:30'}), ['15:30','15:45','18:00','18:15'])
  assert.deepEqual(doctorSlots(sunday, '2026-11-01', {is_available:true,start_time:'16:00',end_time:'18:00'}), [])
})
test('overlaps and malformed ranges are rejected; CSV retains both sessions', () => {
  assert.throws(()=>parseScheduleCell('14:00-16:00;15:00-18:00',0), /overlap/)
  assert.throws(()=>parseScheduleCell('bad input',0))
  assert.throws(()=>parseScheduleCell('24:99-26:00',0))
  assert.throws(()=>parseScheduleCell('20:00-18:00',0))
  assert.equal(scheduleCell(sunday),'14:00-16:00;18:00-20:00')
  const csv='Doctor,Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday\n"Dr. Apu","14:00-16:00;18:00-20:00",OFF,14:00-16:00,OFF,OFF,OFF,OFF'
  assert.equal(parseScheduleCsv(csv).filter(r=>r.day_of_week===0).length,2)
  assert.throws(()=>parseScheduleCsv(csv+'\nDr Apu,OFF,OFF,OFF,OFF,OFF,OFF,OFF'), /exactly once/)
  assert.throws(()=>parseScheduleCsv('Doctor,Sunday\nDr Apu,OFF'), /seven weekdays/)
  assert.equal(sessionValidation([{day_of_week:0,start_time:'14:00',end_time:'16:00',slot_minutes:0}]),'Slot length must be 5–120 minutes.')
})
test('punctuation duplicates become one canonical doctor option; historical labels resolve', () => {
  assert.deepEqual(uniqueDoctorNames(['Dr Rakibul Hasan Apu','Dr. Rakibul Hasan Apu']),['Dr. Rakibul Hasan Apu'])
  assert.ok(doctorNameVariants('Dr Rakibul Hasan Apu — Consultation').includes('Dr. Rakibul Hasan Apu'))
})

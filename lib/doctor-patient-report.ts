export const APPOINTMENT_STATUSES = ['Booked', 'Confirmed visit', 'Completion reported', 'Review required', 'No-show', 'Rescheduled', 'Cancelled', 'Other'] as const
export type AppointmentStatus = typeof APPOINTMENT_STATUSES[number]
export type ReportStatus = AppointmentStatus | 'Not interested'
export type DoctorPatientRecord = {
  record_id: string; kind: 'appointment' | 'not_interested'; doctor: string; raw_doctor: string | null
  identity_key: string; patient_id: number | null; lead_id: number | null; patient_name: string
  phone: string | null; hospital_patient_id: string | null; hn: string | null; area: string | null
  report_date: string; date_basis: string; recorded_at: string | null; status: ReportStatus
  appointment_id?: number; appointment_time?: string | null; service_type?: string | null
  pre_visit_response?: string | null; raw_status?: string | null; agent: string | null; evidence: string
  mis_visit_confirmed?: boolean; verification_reason?: string; candidate_invoice_count?: number
  mis_invoices?: {id:number;number:string;date:string;doctor:string}[]
  previous_appointment_id?: number | null; rescheduled_to_appointment_id?: number | null
  replacement_date?: string | null; replacement_time?: string | null
}
export type DoctorPatientReport = { version: number; read_at: string; start_date: string; end_date: string; records: DoctorPatientRecord[]; mis_coverage: {first_invoice_date:string|null;latest_invoice_date:string|null;invoice_count:number} }
export function recordedOutcome(status: string | null | undefined) {
  return status === 'Confirmed' ? 'Booked (pre-visit response recorded)' : status ?? ''
}
export function hasMisVisitEvidence(record: DoctorPatientRecord) {
  return record.kind === 'appointment' && record.raw_status?.toLowerCase() === 'completed'
    && record.mis_visit_confirmed === true && record.patient_id != null
    && !!record.mis_invoices?.length && record.mis_invoices.every(invoice =>
      !!invoice.number && invoice.date === record.report_date && invoice.doctor === record.doctor)
}
export function summarizeDoctorPatients(records: DoctorPatientRecord[]) {
  const appointments = records.filter(r => r.kind === 'appointment')
  const counts = Object.fromEntries(APPOINTMENT_STATUSES.map(s => [s, appointments.filter(r => r.status === s).length])) as Record<AppointmentStatus, number>
  return { total: appointments.length, patients: new Set(appointments.map(r => r.identity_key)).size,
    unlinked: appointments.filter(r => !r.patient_id && !r.lead_id).length,
    declined: new Set(records.filter(r => r.kind === 'not_interested').map(r => r.identity_key)).size, counts }
}
export function filterDoctorPatients(records: DoctorPatientRecord[], doctor: string, status: string, search: string) {
  const term = search.trim().toLocaleLowerCase()
  return records.filter(r => (!doctor || r.doctor === doctor)
    && (status === 'Not interested' ? r.kind === 'not_interested' : r.kind === 'appointment' && (!status || r.status === status))
    && (!term || [r.patient_name,r.phone,r.hospital_patient_id,r.hn,r.record_id,r.appointment_id,r.lead_id].some(v => String(v ?? '').toLocaleLowerCase().includes(term))))
}
export function doctorReportCsv(records: DoctorPatientRecord[]) {
  const cell = (v: unknown) => {
    const text = String(v ?? '')
    return '"' + (/^[\s]*[=+@\-]/.test(text) ? "'" + text : text).replaceAll('"','""') + '"'
  }
  return [
    ['Doctor','Patient','Phone','Hospital patient ID','HN','Record ID','Appointment ID','Lead ID','Date','Date basis','Time','Visit status','Recorded CRM outcome','Pre-visit response','Service','Agent','Evidence','Recorded at','Rescheduled from','Rescheduled to','Replacement date','Replacement time','MIS visit confirmed','Verification reason','MIS invoice numbers','MIS invoice dates'],
    ...records.map(r => [r.doctor,r.patient_name,r.phone,r.hospital_patient_id,r.hn,r.record_id,r.appointment_id,r.lead_id,r.report_date,r.date_basis,r.appointment_time,r.status,recordedOutcome(r.raw_status),r.pre_visit_response,r.service_type,r.agent,r.evidence,r.recorded_at,r.previous_appointment_id,r.rescheduled_to_appointment_id,r.replacement_date,r.replacement_time,r.kind==='appointment'?(r.mis_visit_confirmed?'Yes':'No'):'',r.verification_reason,r.mis_invoices?.map(i=>i.number).join('; '),r.mis_invoices?.map(i=>i.date).join('; ')]),
  ].map(row => row.map(cell).join(',')).join('\r\n')
}

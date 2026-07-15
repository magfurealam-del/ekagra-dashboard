'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CATEGORY_LABEL } from './types'

function recommendedAction(row: any) {
  switch (row.category) {
    case 'no_show_7':
    case 'no_show_14':
    case 'no_show_28':
      return 'Rebook appointment within 48 hours — timely follow-up increases conversion and patient satisfaction.'
    case 'surgery_no_show':
      return 'Confirm surgery intent and reschedule urgently — this patient was tagged for a scheduled procedure.'
    case 'healing_overdue_4w':
    case 'healing_overdue_8w':
    case 'healing_overdue_old':
      return 'Check on wound healing progress and bring the patient back in for a re-assessment.'
    case 'wound_no_appt':
    case 'screening_no_appt':
      return 'Convert this lead — offer to book a wound care / screening appointment.'
    default:
      return 'Follow up with the patient.'
  }
}

function ageFromDob(dob: string | null) {
  if (!dob) return null
  return Math.floor((Date.now() - new Date(dob).getTime()) / 3.15576e10)
}

export default function PatientDetailPanel({ row }: { row: any | null }) {
  const [patient, setPatient] = useState<any | null>(null)
  const [visitSummary, setVisitSummary] = useState<any | null>(null)
  const [lead, setLead] = useState<any | null>(null)
  const [appointments, setAppointments] = useState<any[]>([])
  const [originalAppt, setOriginalAppt] = useState<any | null>(null)
  const [history, setHistory] = useState<any[]>([])

  useEffect(() => {
    if (!row) {
      setPatient(null)
      setVisitSummary(null)
      setLead(null)
      setAppointments([])
      setOriginalAppt(null)
      setHistory([])
      return
    }
    let cancelled = false
    async function load() {
      if (row.patient_id) {
        const { data: p } = await supabase.from('patients').select('*').eq('id', row.patient_id).single()
        if (!cancelled) setPatient(p)

        const { data: vs } = await supabase
          .from('patient_visit_summary')
          .select('*')
          .eq('patient_id', row.patient_id)
          .maybeSingle()
        if (!cancelled) setVisitSummary(vs)

        const { data: va } = await supabase
          .from('validated_appointments')
          .select('appointment_id, appointment_date, appointment_time, doctor_service, appointment_status, confirmation_status, validated_status, invoice_validated, matched_admission_an, matched_admission_date, notes')
          .eq('resolved_patient_id', row.patient_id)
          .order('appointment_date', { ascending: false })
          .limit(8)
        if (!cancelled) setAppointments(va || [])

        const { data: original } = await supabase
          .from('crm_appointments')
          .select('appointment_date, appointment_time, doctor_service, appointment_type, appointment_status, confirmation_status, notes, created_by, created_at')
          .eq('patient_id', row.patient_id)
          .lte('appointment_date', row.relevant_date || new Date().toISOString().slice(0, 10))
          .order('appointment_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)
        if (!cancelled) setOriginalAppt((original && original[0]) || null)
      } else {
        setPatient(null)
        setVisitSummary(null)
        setAppointments([])
        setOriginalAppt(null)
      }

      if (row.source_table === 'crm_leads' && row.source_id) {
        const { data: l } = await supabase
          .from('crm_leads')
          .select('source, campaign_name, lead_status, main_problem, agent_name, lead_bucket, urgency, notes, referral_name, created_at, intake_outcome, no_appointment_reasons')
          .eq('id', row.source_id)
          .maybeSingle()
        if (!cancelled) setLead(l)
      } else {
        setLead(null)
      }

      const { data: h } = await supabase
        .from('outgoing_call_history_view')
        .select('*')
        .eq('queue_id', row.queue_id)
        .order('followup_number', { ascending: false })
        .limit(5)
      if (!cancelled) setHistory(h || [])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [row?.queue_id, row?.patient_id, row?.source_table, row?.source_id])

  if (!row) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 h-full overflow-y-auto flex items-center justify-center text-sm text-slate-400 p-6">
        Select a patient from the queue to see their details.
      </div>
    )
  }

  const age = ageFromDob(patient?.dob)
  const lastReached = history.find((h) => h.called_at || h.outcome || h.status === 'called')

  return (
    <div className="bg-white rounded-xl border border-slate-200 h-full overflow-y-auto p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-800">{row.patient_name || 'Unknown patient'}</h3>
          {row.category_rank <= 4 && (
            <span className="text-[10px] rounded px-1.5 py-0.5 bg-red-100 text-red-700">High Priority</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500 mt-2">
          <div>Patient ID: {patient?.hospital_patient_id || patient?.hn || row.patient_id || '—'}</div>
          <div>Lead type: {CATEGORY_LABEL[row.category] ?? row.category}</div>
          <div>Phone: {row.phone}</div>
          <div>Location: {row.final_location || patient?.area || '—'}</div>
          <div>
            Age / Sex: {age ?? '—'} / {patient?.gender || '—'}
          </div>
          <div>Patient type: {patient?.patient_type || '—'}</div>
          <div>Diabetes status: {patient?.diabetes_status || '—'}</div>
          <div>Healing status: {patient?.healing_status || 'Not marked'}</div>
          <div className="col-span-2">Initial call reason: {row.reason || lead?.main_problem || 'Not recorded'}</div>
          {patient?.address && <div className="col-span-2">Address: {patient.address}</div>}
          {patient?.created_at && (
            <div className="col-span-2">
              Registered since: {new Date(patient.created_at).toLocaleDateString()}
            </div>
          )}
          {(lead?.source || lead?.campaign_name) && (
            <div className="col-span-2">
              Lead source: {[lead?.source, lead?.campaign_name].filter(Boolean).join(' · ')}
            </div>
          )}
          <div>Lead bucket: {lead?.lead_bucket || 'Not recorded'}</div>
          <div>Urgency: {lead?.urgency || 'Not recorded'}</div>
          {visitSummary && (
            <>
              <div>Total visits: {visitSummary.total_visits ?? 0}</div>
              <div>Last visit: {visitSummary.last_visit_date || '—'}</div>
              {visitSummary.next_appointment_date && (
                <div className="col-span-2 text-teal-700">
                  Next appointment: {visitSummary.next_appointment_date}
                  {visitSummary.next_appointment_doctor ? ` with ${visitSummary.next_appointment_doctor}` : ''}
                </div>
              )}
            </>
          )}
          {row.category.startsWith('surgery') && patient?.surgery_flagged_at && (
            <div className="col-span-2 text-rose-700">
              Tagged for surgery on {patient.surgery_flagged_at}, no admission since
            </div>
          )}
        </div>
        {patient?.crm_notes && (
          <div className="mt-2 text-xs text-slate-500 bg-slate-50 rounded-md p-2">{patient.crm_notes}</div>
        )}
        {lead?.notes && (
          <div className="mt-2 text-xs text-slate-600 bg-amber-50 border border-amber-100 rounded-md p-2">
            <span className="font-medium">Original lead notes:</span> {lead.notes}
          </div>
        )}
        {lead?.no_appointment_reasons?.length > 0 && (
          <div className="mt-2 text-xs text-slate-600 bg-sky-50 border border-sky-100 rounded-md p-2">
            <span className="font-medium">No-appointment reasons:</span> {lead.no_appointment_reasons.join(', ')}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-slate-600 mb-1.5">Original Booking Context</h4>
        {originalAppt ? (
          <div className="bg-indigo-50 border border-indigo-100 rounded-md p-2.5 text-xs text-slate-700 space-y-1">
            <div><span className="font-medium">Booked:</span> {originalAppt.appointment_date} {originalAppt.appointment_time || ''} · {originalAppt.doctor_service || 'Doctor not recorded'}</div>
            <div><span className="font-medium">Status:</span> {originalAppt.appointment_status || 'Not recorded'} · <span className="font-medium">Type:</span> {originalAppt.appointment_type || 'Not recorded'}</div>
            <div><span className="font-medium">Booking comment:</span> {originalAppt.notes || 'No CRM comment recorded'}</div>
            {originalAppt.created_by && <div className="text-slate-500">Booked by {originalAppt.created_by}</div>}
          </div>
        ) : (
          <p className="text-xs text-slate-400">No original CRM booking record found.</p>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-slate-600 mb-1.5">Last Contact</h4>
        {lastReached ? (
          <div className="bg-amber-50 border border-amber-100 rounded-md p-2.5 text-xs text-slate-700 space-y-1">
            <div><span className="font-medium">Last reached:</span> {lastReached.called_at || lastReached.scheduled_date || 'Date not recorded'} · {lastReached.assigned_agent || 'Agent not recorded'}</div>
            <div><span className="font-medium">Outcome/reason:</span> {lastReached.outcome || lastReached.outcome_code || lastReached.status || 'Not recorded'}</div>
            <div><span className="font-medium">Comment:</span> {lastReached.notes || lastReached.attempt_notes || 'No comment recorded'}</div>
          </div>
        ) : (
          <p className="text-xs text-slate-400">No previous reached call recorded.</p>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-slate-600 mb-1.5">① Appointment History</h4>
        {appointments.length > 0 ? (
          <div className="space-y-1.5">
            {appointments.map((appointment) => (
              <div key={appointment.appointment_id} className="bg-slate-50 rounded-md p-2.5 text-xs flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-slate-700 font-medium">{appointment.appointment_date} {appointment.appointment_time || ''} · {appointment.doctor_service || 'Service not specified'}</div>
                  <div className="text-slate-500">{appointment.notes || appointment.confirmation_status || 'No appointment comment'}</div>
                  {appointment.invoice_validated && (
                    <div className="text-emerald-700 mt-0.5">Attended — invoice matched{appointment.matched_admission_an ? ` · AN ${appointment.matched_admission_an}` : ''}{appointment.matched_admission_date ? ` · ${new Date(appointment.matched_admission_date).toLocaleDateString('en-GB')}` : ''}</div>
                  )}
                </div>
                <span className={`shrink-0 text-[10px] rounded px-1.5 py-0.5 ${appointment.invoice_validated ? 'bg-emerald-100 text-emerald-700' : appointment.validated_status === 'No-show' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'}`}>
                  {appointment.invoice_validated ? 'Attended' : appointment.validated_status || appointment.appointment_status || 'Scheduled'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400">No prior appointment on record.</p>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-slate-600 mb-1.5">② Call History (last 5 attempts)</h4>
        {history.length === 0 ? (
          <p className="text-xs text-slate-400">No previous attempts yet.</p>
        ) : (
          <ul className="text-xs text-slate-600 space-y-1.5">
            {history.map((h) => (
              <li key={h.attempt_id} className="border-b border-slate-100 pb-1.5 last:border-0">
                <div className="flex justify-between">
                  <span>
                    {h.scheduled_date} · {h.assigned_agent}
                  </span>
                  <span className="text-slate-500">{h.outcome || h.status}</span>
                </div>
                {h.notes && <div className="text-slate-400 mt-0.5">{h.notes}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-slate-600 mb-1.5">③ Recommended Next Action</h4>
        <div className="bg-emerald-50 border border-emerald-100 rounded-md p-2.5 text-xs text-emerald-800">
          {recommendedAction(row)}
        </div>
      </div>
    </div>
  )
}

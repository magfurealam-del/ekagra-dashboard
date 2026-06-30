'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CATEGORY_LABEL } from './types'

function recommendedAction(row: any) {
  switch (row.category) {
    case 'no_show':
      return 'Rebook appointment within 48 hours — timely follow-up increases conversion and patient satisfaction.'
    case 'surgery_no_show':
      return 'Confirm surgery intent and reschedule urgently — this patient was tagged for a scheduled procedure.'
    case 'healing_overdue':
      return 'Check on wound healing progress and bring the patient back in for a re-assessment.'
    case 'wound_screening_no_appt':
      return 'Convert this lead — offer to book a wound care / screening appointment.'
    default:
      return 'Follow up with the patient.'
  }
}

function suggestedScript(row: any) {
  const name = row.patient_name || 'the patient'
  if (row.category === 'no_show') {
    return `Assalamu Alaikum, ami Ekagra Hospital theke bolchi.\nApnar appointment miss hoye gechilo.\nApni ki notun appointment nite chan?`
  }
  if (row.category === 'healing_overdue') {
    return `Assalamu Alaikum, ami Ekagra Hospital theke bolchi.\nApnar khoto/wound koto din holo dekhi nai.\nApni ki ekta follow-up visit korte parben?`
  }
  return `Assalamu Alaikum, ami Ekagra Hospital theke bolchi.\nApnar shathe ${name} er appointment niye kotha bolte chai.`
}

export default function PatientDetailPanel({ row }: { row: any | null }) {
  const [patient, setPatient] = useState<any | null>(null)
  const [lastAppt, setLastAppt] = useState<any | null>(null)
  const [history, setHistory] = useState<any[]>([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!row) {
      setPatient(null)
      setLastAppt(null)
      setHistory([])
      return
    }
    let cancelled = false
    async function load() {
      if (row.patient_id) {
        const { data: p } = await supabase.from('patients').select('*').eq('id', row.patient_id).single()
        if (!cancelled) setPatient(p)

        const { data: va } = await supabase
          .from('validated_appointments')
          .select('appointment_date, appointment_time, doctor_service, validated_status')
          .eq('resolved_patient_id', row.patient_id)
          .order('appointment_date', { ascending: false })
          .limit(1)
        if (!cancelled) setLastAppt((va && va[0]) || null)
      } else {
        setPatient(null)
        setLastAppt(null)
      }

      const { data: h } = await supabase
        .from('outgoing_call_history_view')
        .select('*')
        .eq('queue_id', row.queue_id)
        .order('followup_number', { ascending: false })
        .limit(3)
      if (!cancelled) setHistory(h || [])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [row?.queue_id, row?.patient_id])

  if (!row) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 h-full flex items-center justify-center text-sm text-slate-400 p-6">
        Select a patient from the queue to see their details.
      </div>
    )
  }

  function copyScript() {
    navigator.clipboard?.writeText(suggestedScript(row))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 h-full overflow-y-auto p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-800">{row.patient_name || 'Unknown patient'}</h3>
          {row.category_rank <= 2 && (
            <span className="text-[10px] rounded px-1.5 py-0.5 bg-red-100 text-red-700">High Priority</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500 mt-2">
          <div>Patient ID: {patient?.hospital_patient_id || patient?.hn || row.patient_id || '—'}</div>
          <div>Lead type: {CATEGORY_LABEL[row.category] ?? row.category}</div>
          <div>Phone: {row.phone}</div>
          <div>Location: {row.final_location || patient?.area || '—'}</div>
          <div>
            Age / Sex: {patient?.dob ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / 3.15576e10) : '—'} /{' '}
            {patient?.gender || '—'}
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-slate-600 mb-1.5">① Appointment History</h4>
        {lastAppt ? (
          <div className="bg-slate-50 rounded-md p-2.5 text-xs flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-slate-700 font-medium">
                {lastAppt.appointment_date} {lastAppt.appointment_time}
              </div>
              <div className="text-slate-500">{lastAppt.doctor_service || 'Service not specified'}</div>
            </div>
            <span
              className={`text-[10px] rounded px-1.5 py-0.5 ${
                lastAppt.validated_status === 'No-show'
                  ? 'bg-amber-100 text-amber-700'
                  : lastAppt.validated_status === 'Completed'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-200 text-slate-600'
              }`}
            >
              {lastAppt.validated_status}
            </span>
          </div>
        ) : (
          <p className="text-xs text-slate-400">No prior appointment on record.</p>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-slate-600 mb-1.5">② Call History (last 3 attempts)</h4>
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

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-xs font-semibold text-slate-600">Suggested Script</h4>
          <button onClick={copyScript} className="text-[11px] text-teal-700 hover:text-teal-800">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="bg-sky-50 border border-sky-100 rounded-md p-2.5 text-xs text-sky-900 whitespace-pre-line">
          {suggestedScript(row)}
        </div>
      </div>
    </div>
  )
}

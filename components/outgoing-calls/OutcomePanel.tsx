'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import SearchableSelect from '@/components/SearchableSelect'
import { useDropdownOptions } from '@/hooks/useDropdownOptions'
import { BRANCHES, OUTCOMES, OutcomeCode } from './types'

type SaveState = 'idle' | 'saving' | 'success' | 'failed' | 'stale'

function buildOutboundWhatsAppMessage(row: any, details: { doctor: string; apptDate: string; apptTime: string; serviceType: string; branch: string; agentName: string }): string {
  const date = details.apptDate ? new Date(`${details.apptDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: '2-digit' }) : '—'
  return [
    'Entry Type: Outbound Call',
    `Patient Name: ${row.patient_name || '—'}`,
    `Contact Number: ${row.phone || '—'}`,
    `Source: ${row.source || row.source_channel || '—'}`,
    `Appointment Date: ${date}`,
    `Appointment Time: ${details.apptTime || '—'}`,
    `Appointment For: ${details.serviceType || '—'}`,
    `Doctor/Service: ${details.doctor || '—'}`,
    `Coming From: ${row.final_location || row.location || '—'}`,
    `Patient Concern: ${row.reason || row.main_problem || '—'}`,
  ].join('\n')
}

export default function OutcomePanel({
  row,
  agentName,
  onSaved,
}: {
  row: any | null
  agentName: string
  onSaved: () => void
}) {
  const [selected, setSelected] = useState<OutcomeCode | null>(null)
  const [notes, setNotes] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [copyLabel, setCopyLabel] = useState('Copy Message')

  // Booked appointment fields
  const [apptDate, setApptDate] = useState('')
  const [apptTime, setApptTime] = useState('')
  const [serviceType, setServiceType] = useState('')
  const [branch, setBranch] = useState(BRANCHES[0])
  const [doctor, setDoctor] = useState('')
  const [doctors, setDoctors] = useState<{ label: string; value: string }[]>([])
  const [reasonValues, setReasonValues] = useState<string[]>([])
  const [waitDays, setWaitDays] = useState(14)
  const reasonOptions = useDropdownOptions('intake_no_appointment_reason')
  const serviceOptions = useDropdownOptions('service_type')
  const branchOptions = useDropdownOptions('branch')


  useEffect(() => {
    setSelected(null)
    setNotes('')
    setSaveState('idle')
    setErrorMsg('')
    setCopyLabel('Copy Message')
    setApptDate('')
    setApptTime('')
    setServiceType('')
    setDoctor('')
    setReasonValues([])
    setWaitDays(14)
  }, [row?.attempt_id])

  useEffect(() => {
    supabase.from('doctors').select('name').eq('is_active', true).order('name').then(({ data }) => {
      setDoctors((data || []).map((d) => ({ label: d.name, value: d.name })))
    })
  }, [])

  if (!row) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 h-full flex items-center justify-center text-sm text-slate-400 p-6">
        Outcome options appear here once a patient is selected.
      </div>
    )
  }

  const def = OUTCOMES.find((o) => o.code === selected)
  const whatsappMessage = buildOutboundWhatsAppMessage(row, { doctor, apptDate, apptTime, serviceType, branch, agentName })

  async function copyWhatsAppMessage() {
    try {
      await navigator.clipboard.writeText(whatsappMessage)
      setCopyLabel('Copied!')
      setTimeout(() => setCopyLabel('Copy Message'), 2000)
    } catch {
      setCopyLabel('Copy failed')
      setTimeout(() => setCopyLabel('Copy Message'), 2000)
    }
  }

  async function save() {
    if (!def) return
    setErrorMsg('')

    if (def.code === 'booked_appointment' && (!doctor || !apptDate || !apptTime || !serviceType || !branch)) {
      setErrorMsg('Doctor, date, time, service type, and branch are all required to book an appointment.')
      return
    }
    const reasonNote = selected === 'reached' && reasonValues.length > 0
      ? `No appointment reasons: ${reasonValues.join(', ')}`
      : ''
    const savedNotes = [notes.trim(), reasonNote].filter(Boolean).join('\n') || null

    setSaveState('saving')

    const { data: liveAttempt, error: liveErr } = await supabase
      .from('outgoing_call_attempts')
      .select('status')
      .eq('id', row.attempt_id)
      .single()
    if (liveErr || !liveAttempt || liveAttempt.status !== 'pending') {
      setSaveState('stale')
      return
    }

    try {
      if (def.code === 'booked_appointment') {
        const { error } = await supabase.rpc('book_appointment_from_call', {
          p_attempt_id: row.attempt_id,
          p_appointment_date: apptDate,
          p_appointment_time: apptTime,
          p_doctor_service: `${doctor} — ${serviceType}`,
          p_branch: branch,
          p_notes: savedNotes,
          p_agent_name: agentName,
        })
        if (error) throw error
      } else {
        const { error } = await supabase.rpc('record_call_attempt_outcome', {
          p_attempt_id: row.attempt_id,
          p_outcome: def.label,
          p_status: def.code === 'not_reached' ? 'no_answer' : 'called',
          p_notes: savedNotes,
          p_resolve: def.resolve,
          p_wait_days: selected === 'reached' ? waitDays : 3,
          p_outcome_code: def.code,
          p_agent_name: agentName,
          p_callback_at: null,
          p_confirmed: false,
        })
        if (error) throw error
      }
      setSaveState('success')
      setTimeout(() => {
        onSaved()
      }, 700)
    } catch (e: any) {
      setSaveState('failed')
      setErrorMsg(e.message || 'Something went wrong saving this outcome.')
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 h-full overflow-y-auto p-4 space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">Call Outcome</h3>
      {selected === 'booked_appointment' && (
        <div className="border border-emerald-200 bg-emerald-50/50 rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-slate-700">WhatsApp Message</div>
              <div className="text-[11px] text-emerald-700">Appointment group message for the confirmed outbound call</div>
            </div>
            <button onClick={copyWhatsAppMessage} className="bg-emerald-600 text-white px-2.5 py-1.5 rounded-md text-xs font-medium hover:bg-emerald-700">
              {copyLabel}
            </button>
          </div>
          <pre className="whitespace-pre-wrap break-words text-xs bg-white border border-emerald-100 rounded-md p-2.5 font-sans text-slate-700">{whatsappMessage}</pre>
        </div>
      )}
      <div>
        <div className="text-xs text-slate-500 mb-1.5">Select outcome (one-click)</div>
        <div className="grid grid-cols-2 gap-2">
          {OUTCOMES.map((o) => (
            <button
              key={o.code}
              onClick={() => setSelected(o.code)}
              className={`text-xs font-medium rounded-md border px-2.5 py-2 text-left ${o.tone} ${
                selected === o.code ? 'ring-2 ring-offset-1 ring-teal-500' : ''
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {selected === 'booked_appointment' && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <div className="text-xs font-medium text-slate-600">Booked Appointment Details</div>
          <label className="text-xs text-slate-500 block">Doctor *<SearchableSelect options={doctors} value={doctor} onChange={setDoctor} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-500">
              Appointment date *
              <input
                type="date"
                className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                value={apptDate}
                onChange={(e) => setApptDate(e.target.value)}
              />
            </label>
            <label className="text-xs text-slate-500">
              Time *
              <input
                type="time"
                className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                value={apptTime}
                onChange={(e) => setApptTime(e.target.value)}
              />
            </label>
          </div>
          <label className="text-xs text-slate-500 block">Service type *<SearchableSelect options={serviceOptions.options} value={serviceType} onChange={setServiceType} /></label>
          <label className="text-xs text-slate-500 block">
            Branch *
            <SearchableSelect options={branchOptions.options.length ? branchOptions.options : BRANCHES.map((b) => ({ label: b, value: b }))} value={branch} onChange={setBranch} />
          </label>
        </div>
      )}

      {selected === 'reached' && (
        <div className="border-t border-slate-100 pt-3 space-y-3">
          <div>
            <div className="text-xs font-medium text-slate-600 mb-2">Why no appointment yet?</div>
            <div className="grid grid-cols-2 gap-2">
              {reasonOptions.options.map((reason) => (
                <label key={reason.value} className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={reasonValues.includes(reason.value)} onChange={(e) => setReasonValues((current) => e.target.checked ? [...current, reason.value] : current.filter((v) => v !== reason.value))} />
                  {reason.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-600 mb-1">Call back in</div>
            <div className="flex flex-wrap gap-2">
              {[
                { label: '3 days', days: 3 },
                { label: '1 week', days: 7 },
                { label: '2 weeks', days: 14 },
                { label: '3 weeks', days: 21 },
                { label: '4 weeks', days: 28 },
              ].map(({ label, days }) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setWaitDays(days)}
                  className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
                    waitDays === days
                      ? 'border-teal-500 bg-teal-50 text-teal-700 ring-1 ring-teal-400'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {waitDays >= 14 && (
              <p className="text-xs text-amber-700 mt-1.5">
                Patient will be snoozed for {waitDays} days — next call scheduled {waitDays === 14 ? '2 weeks' : waitDays === 21 ? '3 weeks' : '4 weeks'} out.
              </p>
            )}
          </div>
        </div>
      )}

      {selected && (
        <div className="border-t border-slate-100 pt-3 space-y-2">
          <label className="text-xs text-slate-500 block">
            Notes
            <textarea
              className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
              rows={3}
              maxLength={250}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>

          {errorMsg && <p className="text-xs text-rose-600">{errorMsg}</p>}

          {saveState === 'stale' && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
              This call was already actioned by someone else. Refreshing the queue…
            </p>
          )}
          {saveState === 'failed' && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2">
              Save failed — please try again.
            </p>
          )}
          {saveState === 'success' && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-2">
              Saved — syncing to Supabase…
            </p>
          )}

          <button
            onClick={save}
            disabled={saveState === 'saving' || saveState === 'success' || saveState === 'stale'}
            className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-medium rounded-md py-2"
          >
            {saveState === 'saving' ? 'Saving…' : 'Save Outcome'}
          </button>
        </div>
      )}
    </div>
  )
}

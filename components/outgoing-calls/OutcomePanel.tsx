'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BRANCHES, OUTCOMES, OutcomeCode } from './types'

type SaveState = 'idle' | 'saving' | 'success' | 'failed' | 'stale'

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

  // Booked appointment fields
  const [apptDate, setApptDate] = useState('')
  const [apptTime, setApptTime] = useState('')
  const [serviceType, setServiceType] = useState('')
  const [branch, setBranch] = useState(BRANCHES[0])

  // Call later fields
  const [callbackDate, setCallbackDate] = useState('')
  const [callbackTime, setCallbackTime] = useState('')

  // Confirmation fields
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    setSelected(null)
    setNotes('')
    setSaveState('idle')
    setErrorMsg('')
    setApptDate('')
    setApptTime('')
    setServiceType('')
    setCallbackDate('')
    setCallbackTime('')
    setConfirmed(false)
  }, [row?.attempt_id])

  if (!row) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 h-full flex items-center justify-center text-sm text-slate-400 p-6">
        Outcome options appear here once a patient is selected.
      </div>
    )
  }

  const def = OUTCOMES.find((o) => o.code === selected)

  async function save() {
    if (!def) return
    setErrorMsg('')

    if (def.code === 'booked_appointment' && (!apptDate || !apptTime || !serviceType || !branch)) {
      setErrorMsg('Date, time, service type, and branch are all required to book an appointment.')
      return
    }
    if (def.code === 'call_later' && (!callbackDate || !callbackTime)) {
      setErrorMsg('A callback date and time are required.')
      return
    }
    if ((def.code === 'wrong_number' || def.code === 'do_not_call') && !confirmed) {
      setErrorMsg('Please confirm before saving this outcome.')
      return
    }

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
          p_doctor_service: serviceType,
          p_branch: branch,
          p_notes: notes || null,
          p_agent_name: agentName,
        })
        if (error) throw error
      } else if (def.code === 'call_later') {
        const callbackIso = new Date(`${callbackDate}T${callbackTime}:00+06:00`).toISOString()
        const { error } = await supabase.rpc('record_call_attempt_outcome', {
          p_attempt_id: row.attempt_id,
          p_outcome: def.label,
          p_status: 'called',
          p_notes: notes || null,
          p_resolve: false,
          p_wait_days: 3,
          p_outcome_code: def.code,
          p_agent_name: agentName,
          p_callback_at: callbackIso,
          p_confirmed: false,
        })
        if (error) throw error
      } else {
        const { error } = await supabase.rpc('record_call_attempt_outcome', {
          p_attempt_id: row.attempt_id,
          p_outcome: def.label,
          p_status: def.code === 'not_reached' ? 'no_answer' : 'called',
          p_notes: notes || null,
          p_resolve: def.resolve,
          p_wait_days: 3,
          p_outcome_code: def.code,
          p_agent_name: agentName,
          p_callback_at: null,
          p_confirmed: def.code === 'wrong_number' || def.code === 'do_not_call' ? confirmed : false,
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
          <label className="text-xs text-slate-500 block">
            Service type *
            <input
              className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
              placeholder="e.g. Orthopedic Consultation"
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value)}
            />
          </label>
          <label className="text-xs text-slate-500 block">
            Branch *
            <select
              className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            >
              {BRANCHES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {selected === 'call_later' && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <div className="text-xs font-medium text-slate-600">Callback Details</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-500">
              Callback date *
              <input
                type="date"
                className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                value={callbackDate}
                onChange={(e) => setCallbackDate(e.target.value)}
              />
            </label>
            <label className="text-xs text-slate-500">
              Time *
              <input
                type="time"
                className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                value={callbackTime}
                onChange={(e) => setCallbackTime(e.target.value)}
              />
            </label>
          </div>
        </div>
      )}

      {(selected === 'wrong_number' || selected === 'do_not_call') && (
        <div className="border-t border-slate-100 pt-3">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            {selected === 'wrong_number'
              ? 'Confirm this number is wrong — patient will be removed from the active queue.'
              : 'Confirm this patient should never be called again.'}
          </label>
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
            disabled={saveState === 'saving' || saveState === 'success'}
            className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-medium rounded-md py-2"
          >
            {saveState === 'saving' ? 'Saving…' : 'Save Outcome'}
          </button>
        </div>
      )}
    </div>
  )
}

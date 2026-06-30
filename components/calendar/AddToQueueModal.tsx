'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type Props = {
  appointment: any
  onClose: () => void
  onSaved: () => void
}

const PRIORITIES = [
  { value: 1, label: 'P1 — Urgent' },
  { value: 2, label: 'P2 — High' },
  { value: 3, label: 'P3 — Medium' },
  { value: 4, label: 'P4 — Low' },
]

const AGENTS = ['Yakub', 'Fatema']

export default function AddToQueueModal({ appointment, onClose, onSaved }: Props) {
  const [reason, setReason] = useState('Appointment confirmation follow-up')
  const [priority, setPriority] = useState(2)
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0,10))
  const [agent, setAgent] = useState(AGENTS[0])
  const [pinned, setPinned] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setError('')

    // Deduplicate: check for existing open entry for this appointment
    const { data: existing } = await supabase
      .from('outgoing_call_queue')
      .select('id')
      .eq('source_table', 'crm_appointments')
      .eq('source_id', String(appointment.appointment_id))
      .eq('status', 'open')
      .maybeSingle()

    if (existing) {
      setError('This patient already has an open entry in the call queue.')
      setSaving(false)
      return
    }

    const { error: insertErr } = await supabase.from('outgoing_call_queue').insert({
      patient_id:    appointment.patient_id,
      patient_name:  appointment.patient_name || 'Unknown',
      phone:         appointment.phone,
      category:      'no_show_7',
      category_rank: priority,
      reason,
      relevant_date: appointment.appointment_date,
      source_table:  'crm_appointments',
      source_id:     String(appointment.appointment_id),
      final_location: appointment.location,
      lead_type:     'Appointment confirmation',
      pinned_to_top: pinned,
      no_show_risk:  appointment.no_show_risk,
    })

    if (insertErr) { setError(insertErr.message); setSaving(false); return }

    // Also log the appointment event
    await supabase.from('appointment_events').insert({
      appointment_id: appointment.appointment_id,
      patient_id:     appointment.patient_id,
      event_type:     'added_to_outgoing_queue',
      new_value:      reason,
      agent_name:     agent,
      notes,
    })

    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Add to Outgoing Call Queue</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
        </div>
        <div className="bg-slate-50 rounded-md p-2.5 text-xs text-slate-600">
          <div className="font-medium">{appointment.patient_name || 'Unknown'}</div>
          <div>{appointment.phone} · {appointment.doctor_service} · {appointment.appointment_date} {appointment.appointment_time}</div>
        </div>

        <label className="block text-xs text-slate-500">
          Reason *
          <input value={reason} onChange={e => setReason(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-slate-500">
            Priority *
            <select value={priority} onChange={e => setPriority(Number(e.target.value))}
              className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white">
              {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label className="block text-xs text-slate-500">
            Due date *
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </label>
        </div>

        <label className="block text-xs text-slate-500">
          Assign to agent
          <select value={agent} onChange={e => setAgent(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white">
            {AGENTS.map(a => <option key={a}>{a}</option>)}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} />
          Pin to top of queue
        </label>

        <label className="block text-xs text-slate-500">
          Notes
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        </label>

        {error && <p className="text-xs text-rose-600">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 border border-slate-300 rounded-md py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-md py-2 text-sm font-medium">
            {saving ? 'Saving…' : 'Add to Queue'}
          </button>
        </div>
      </div>
    </div>
  )
}

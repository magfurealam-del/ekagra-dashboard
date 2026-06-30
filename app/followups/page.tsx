'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useDropdownOptions } from '@/hooks/useDropdownOptions'

export default function FollowupsPage() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const outcomeOpts = useDropdownOptions('followup_outcome')

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('no_show_follow_up_queue_view').select('*').order('priority_rank').order('missed_appointment_date', { ascending: false })
    if (!error && data) setRows(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('followup-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_appointments' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_follow_ups' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  async function logFollowUp(patientId: number, appointmentId: number, outcome: string, nextDate: string, agent: string) {
    const { error } = await supabase.rpc('log_follow_up_attempt', {
      payload: {
        patient_id: patientId, appointment_id: appointmentId, outcome,
        next_follow_up_date: nextDate || null, agent_name: agent, log_call: 'true',
      },
    })
    if (error) { showToast('Failed: ' + error.message); return }
    showToast('Follow-up attempt saved.')
    load()
  }

  return (
    <div className="space-y-4 pb-20">
      <h1 className="text-2xl font-semibold">No-Shows & Follow-ups</h1>
      <p className="text-sm text-slate-500">Priority: wound no-shows → screening no-shows → 2+ weeks unhealed → wound leads with no appt → screening leads with no appt → general.</p>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        {loading ? <p className="p-4 text-sm text-slate-500">Loading…</p> : rows.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Queue is empty.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Patient</th>
                <th className="text-left px-3 py-2">Phone</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Missed date</th>
                <th className="text-left px-3 py-2">Follow-up #</th>
                <th className="text-left px-3 py-2">Last outcome</th>
                <th className="text-left px-3 py-2">Log outcome</th>
                <th className="text-left px-3 py-2">Next follow-up</th>
                <th className="text-left px-3 py-2">Agent</th>
                <th className="text-left px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <FollowupRow key={`${r.patient_id}-${r.appointment_id}`} r={r} outcomeOpts={outcomeOpts.options} onLog={logFollowUp} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast && <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-sm px-4 py-3 rounded-md shadow-lg">{toast}</div>}
    </div>
  )
}

function FollowupRow({ r, outcomeOpts, onLog }: any) {
  const [outcome, setOutcome] = useState('Not Called Yet')
  const [nextDate, setNextDate] = useState('')
  const [agent, setAgent] = useState('')

  return (
    <tr className="border-t border-slate-100">
      <td className="px-3 py-2 font-medium">{r.patient_name}</td>
      <td className="px-3 py-2">{r.phone}</td>
      <td className="px-3 py-2">{r.patient_type}</td>
      <td className="px-3 py-2">{r.missed_appointment_date}</td>
      <td className="px-3 py-2">{r.follow_up_count}/3</td>
      <td className="px-3 py-2">{r.latest_outcome || '—'}</td>
      <td className="px-3 py-2">
        <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          {outcomeOpts.map((o: any) => <option key={o.value} value={o.label}>{o.label}</option>)}
        </select>
      </td>
      <td className="px-3 py-2">
        <input type="date" className="input" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
      </td>
      <td className="px-3 py-2">
        <input className="input w-24" placeholder="Agent" value={agent} onChange={(e) => setAgent(e.target.value)} />
      </td>
      <td className="px-3 py-2">
        <button onClick={() => onLog(r.patient_id, r.appointment_id, outcome, nextDate, agent)} className="bg-teal-600 text-white px-3 py-1.5 rounded-md text-xs font-medium">Save</button>
      </td>
    </tr>
  )
}

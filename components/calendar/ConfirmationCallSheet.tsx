'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import AddToQueueModal from './AddToQueueModal'

const TABS = ['All Patients','Night-Before Calls','Morning-Of Calls','Pending Calls','No-Show Risk','Confirmed'] as const
type Tab = typeof TABS[number]

const OUTCOME_BUTTONS = [
  { label: 'Confirmed ✓',      outcome: 'confirmed',        tone: 'bg-emerald-600 text-white' },
  { label: 'Not Reached',      outcome: 'not_reached',      tone: 'bg-slate-200 text-slate-700' },
  { label: 'Busy',             outcome: 'busy',             tone: 'bg-amber-100 text-amber-700' },
  { label: 'Switched Off',     outcome: 'switched_off',     tone: 'bg-slate-200 text-slate-600' },
  { label: 'Reschedule',       outcome: 'wants_reschedule', tone: 'bg-purple-100 text-purple-700' },
  { label: 'Cancelled',        outcome: 'cancelled',        tone: 'bg-rose-100 text-rose-700' },
  { label: 'Wrong #',          outcome: 'wrong_number',     tone: 'bg-rose-200 text-rose-700' },
]

const STATUS_BADGE: Record<string, string> = {
  Confirmed:      'bg-emerald-100 text-emerald-700',
  'Not Confirmed':'bg-amber-100 text-amber-700',
  confirmed:      'bg-emerald-100 text-emerald-700',
  Completed:      'bg-emerald-100 text-emerald-700',
  'No-show':      'bg-rose-100 text-rose-700',
  Booked:         'bg-sky-100 text-sky-700',
  Scheduled:      'bg-sky-100 text-sky-700',
  Pending:        'bg-amber-100 text-amber-700',
  wants_reschedule:'bg-purple-100 text-purple-700',
  not_reached:    'bg-slate-200 text-slate-600',
  busy:           'bg-amber-100 text-amber-700',
  switched_off:   'bg-slate-200 text-slate-600',
  wrong_number:   'bg-rose-200 text-rose-700',
}

const RISK_BADGE: Record<string, string> = {
  high:   'bg-rose-100 text-rose-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-emerald-100 text-emerald-700',
}

function outcomeLabel(outcome: string | null) {
  if (!outcome) return '—'
  return outcome.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function ConfirmationCallSheet({
  date, onClose,
}: { date: string; onClose: () => void }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('All Patients')
  const [agentName, setAgentName] = useState('Yakub')
  const [saving, setSaving] = useState<number | null>(null)
  const [queueModal, setQueueModal] = useState<any | null>(null)
  const [toast, setToast] = useState('')
  const [page, setPage] = useState(1)
  const PER_PAGE = 10

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('calendar_appointment_detail')
      .select('*')
      .eq('appointment_date', date)
      .neq('appointment_status', 'Cancelled')
      .order('appointment_time')
    setRows(data || [])
    setLoading(false)
  }, [date])

  useEffect(() => { load() }, [load])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  const filtered = rows.filter(r => {
    if (tab === 'Night-Before Calls') return !r.nb_outcome
    if (tab === 'Morning-Of Calls')   return !r.mo_outcome
    if (tab === 'Pending Calls')       return r.confirmation_status !== 'Confirmed' && r.confirmation_status !== 'confirmed'
    if (tab === 'No-Show Risk')        return r.no_show_risk === 'high'
    if (tab === 'Confirmed')           return r.confirmation_status === 'Confirmed' || r.confirmation_status === 'confirmed'
    return true
  })

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))

  async function recordCall(row: any, callType: 'night_before' | 'morning_of', outcome: string) {
    setSaving(row.appointment_id)
    const { error } = await supabase.rpc('record_confirmation_call', {
      p_appointment_id: row.appointment_id,
      p_patient_id:     row.patient_id,
      p_agent_name:     agentName,
      p_call_type:      callType,
      p_outcome:        outcome,
      p_attempt:        1,
      p_notes:          null,
    })
    setSaving(null)
    if (error) { showToast('Error: ' + error.message); return }
    showToast(`${callType === 'night_before' ? 'Night-before' : 'Morning-of'} call saved — ${outcome}`)
    load()
  }

  const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="bg-white rounded-xl border border-slate-200 flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">Appointment Confirmation Call Sheet</h3>
          <p className="text-xs text-slate-500">{formattedDate}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={agentName}
            onChange={e => setAgentName(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1 text-xs bg-white"
          >
            <option>Yakub</option>
            <option>Fatema</option>
          </select>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm px-1">✕</button>
        </div>
      </div>

      {/* Tab row + day summary */}
      <div className="flex-shrink-0 border-b border-slate-100">
        <div className="flex flex-wrap gap-1 px-3 pt-2">
          {TABS.map(t => (
            <button key={t} onClick={() => { setTab(t); setPage(1) }}
              className={`text-xs px-2.5 py-1.5 rounded-md transition-colors ${
                tab === t ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}>
              {t}{t === 'All Patients' ? ` (${rows.length})` : ''}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2 px-3 py-2">
          {[
            { l: 'Total',    v: rows.length,                                                     tone: 'text-slate-800' },
            { l: 'Confirmed',v: rows.filter(r=>r.confirmation_status==='Confirmed').length,       tone: 'text-emerald-600' },
            { l: 'Pending',  v: rows.filter(r=>r.confirmation_status!=='Confirmed').length,       tone: 'text-amber-600' },
            { l: 'Risk',     v: rows.filter(r=>r.no_show_risk==='high').length,                   tone: 'text-rose-600' },
          ].map(m => (
            <div key={m.l} className="bg-slate-50 rounded-md p-1.5 text-center">
              <div className={`text-lg font-bold ${m.tone}`}>{m.v}</div>
              <div className="text-[10px] text-slate-400">{m.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="p-4 space-y-2">{[0,1,2].map(i=><div key={i} className="h-12 bg-slate-100 rounded animate-pulse"/>)}</div>
        ) : paginated.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">No appointments match this tab.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0">
              <tr className="text-left text-slate-500">
                <th className="px-2 py-2 font-medium">Time</th>
                <th className="px-2 py-2 font-medium">Patient</th>
                <th className="px-2 py-2 font-medium">Doctor</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Night Before</th>
                <th className="px-2 py-2 font-medium">Morning Of</th>
                <th className="px-2 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginated.map(r => (
                <tr key={r.appointment_id} className={`hover:bg-slate-50 ${saving === r.appointment_id ? 'opacity-50' : ''}`}>
                  <td className="px-2 py-2 font-medium text-slate-700 whitespace-nowrap">{r.appointment_time || '—'}</td>
                  <td className="px-2 py-2">
                    <div className="font-medium text-slate-800 truncate max-w-[100px]">{r.patient_name || 'Unknown'}</div>
                    <div className="text-slate-400 truncate max-w-[100px]">{r.phone}</div>
                  </td>
                  <td className="px-2 py-2 text-slate-600 truncate max-w-[80px]">
                    {(r.doctor_service || '—').replace('Dr. ','Dr ')}
                  </td>
                  <td className="px-2 py-2">
                    <span className={`text-[10px] rounded px-1.5 py-0.5 ${STATUS_BADGE[r.appointment_status] ?? 'bg-slate-100 text-slate-500'}`}>
                      {r.appointment_status}
                    </span>
                    {r.no_show_risk && (
                      <span className={`ml-1 text-[10px] rounded px-1.5 py-0.5 ${RISK_BADGE[r.no_show_risk]}`}>
                        {r.no_show_risk} risk
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {r.nb_outcome ? (
                      <div>
                        <span className={`text-[10px] rounded px-1.5 py-0.5 ${STATUS_BADGE[r.nb_outcome] ?? 'bg-slate-100'}`}>
                          {outcomeLabel(r.nb_outcome)}
                        </span>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {r.nb_agent} {r.nb_called_at ? new Date(r.nb_called_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : ''}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {OUTCOME_BUTTONS.slice(0,4).map(b => (
                          <button key={b.outcome} onClick={() => recordCall(r, 'night_before', b.outcome)}
                            className={`text-[10px] px-1.5 py-0.5 rounded ${b.tone}`}>
                            {b.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {r.mo_outcome ? (
                      <div>
                        <span className={`text-[10px] rounded px-1.5 py-0.5 ${STATUS_BADGE[r.mo_outcome] ?? 'bg-slate-100'}`}>
                          {outcomeLabel(r.mo_outcome)}
                        </span>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {r.mo_agent} {r.mo_called_at ? new Date(r.mo_called_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : ''}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {OUTCOME_BUTTONS.slice(0,4).map(b => (
                          <button key={b.outcome} onClick={() => recordCall(r, 'morning_of', b.outcome)}
                            className={`text-[10px] px-1.5 py-0.5 rounded ${b.tone}`}>
                            {b.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1">
                      {r.phone && (
                        <a href={`tel:${r.phone}`}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">
                          Call
                        </a>
                      )}
                      <button onClick={() => setQueueModal(r)}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200">
                        + Queue
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-t border-slate-100 text-xs text-slate-500">
          <span>Showing {(page-1)*PER_PAGE+1}–{Math.min(page*PER_PAGE, filtered.length)} of {filtered.length}</span>
          <div className="flex gap-1">
            <button disabled={page===1} onClick={() => setPage(p => p-1)}
              className="px-2 py-1 border rounded disabled:opacity-40">←</button>
            {Array.from({length: Math.min(totalPages, 5)}, (_,i) => i+1).map(p => (
              <button key={p} onClick={() => setPage(p)}
                className={`px-2 py-1 border rounded ${page===p ? 'bg-teal-600 text-white border-teal-600' : ''}`}>{p}</button>
            ))}
            <button disabled={page===totalPages} onClick={() => setPage(p => p+1)}
              className="px-2 py-1 border rounded disabled:opacity-40">→</button>
          </div>
        </div>
      )}

      {queueModal && (
        <AddToQueueModal
          appointment={queueModal}
          onClose={() => setQueueModal(null)}
          onSaved={() => { setQueueModal(null); showToast('Added to outgoing call queue') }}
        />
      )}

      {toast && (
        <div className="absolute bottom-4 right-4 bg-slate-900 text-white text-xs px-3 py-2 rounded-md shadow-lg z-10">
          {toast}
        </div>
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AddToQueueModal from './AddToQueueModal'

const TABS = ['All Patients','Night-Before Calls','Morning-Of Calls','Pending Calls','No-Show Risk','Confirmed'] as const
type Tab = typeof TABS[number]

const OUTCOME_BUTTONS = [
  { label: 'Confirmed ✓',   outcome: 'confirmed',        tone: 'bg-emerald-600 text-white hover:bg-emerald-700 hover:ring-2 hover:ring-emerald-400 hover:ring-offset-1' },
  { label: 'Not Reached',   outcome: 'not_reached',      tone: 'bg-slate-200 text-slate-700 hover:bg-slate-300 hover:ring-2 hover:ring-slate-400 hover:ring-offset-1' },
  { label: 'Busy',          outcome: 'busy',             tone: 'bg-amber-100 text-amber-700 hover:bg-amber-200 hover:ring-2 hover:ring-amber-400 hover:ring-offset-1' },
  { label: 'Switched Off',  outcome: 'switched_off',     tone: 'bg-slate-200 text-slate-600 hover:bg-slate-300 hover:ring-2 hover:ring-slate-400 hover:ring-offset-1' },
  { label: 'Reschedule',    outcome: 'wants_reschedule', tone: 'bg-purple-100 text-purple-700 hover:bg-purple-200 hover:ring-2 hover:ring-purple-400 hover:ring-offset-1' },
  { label: 'Cancelled',     outcome: 'cancelled',        tone: 'bg-rose-100 text-rose-700 hover:bg-rose-200 hover:ring-2 hover:ring-rose-400 hover:ring-offset-1' },
  { label: 'Wrong #',       outcome: 'wrong_number',     tone: 'bg-rose-200 text-rose-700 hover:bg-rose-300 hover:ring-2 hover:ring-rose-500 hover:ring-offset-1' },
]

const STATUS_BADGE: Record<string, string> = {
  Confirmed:        'bg-emerald-100 text-emerald-700',
  'Not Confirmed':  'bg-amber-100 text-amber-700',
  confirmed:        'bg-emerald-100 text-emerald-700',
  Completed:        'bg-emerald-100 text-emerald-700',
  'No-show':        'bg-rose-100 text-rose-700',
  Booked:           'bg-sky-100 text-sky-700',
  Scheduled:        'bg-sky-100 text-sky-700',
  Pending:          'bg-amber-100 text-amber-700',
  wants_reschedule: 'bg-purple-100 text-purple-700',
  not_reached:      'bg-slate-200 text-slate-600',
  busy:             'bg-amber-100 text-amber-700',
  switched_off:     'bg-slate-200 text-slate-600',
  wrong_number:     'bg-rose-200 text-rose-700',
}

const RISK_BADGE: Record<string, string> = {
  high:   'bg-rose-100 text-rose-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-emerald-100 text-emerald-700',
}

function outcomeLabel(outcome: string | null) {
  if (!outcome) return '—'
  return outcome.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Parse patient name / phone / reason out of the notes field used by imported appointments
function parseNotes(notes: string | null): { display: string; phone: string | null } {
  if (!notes) return { display: '—', phone: null }
  // Pattern: "Name · Location · +880... — reason"
  const phoneMatch = notes.match(/(\+\d{10,15})/)
  return { display: notes, phone: phoneMatch ? phoneMatch[1] : null }
}

export default function ConfirmationCallSheet({
  date, onClose,
}: { date: string; onClose: () => void }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('All Patients')
  const [agentName, setAgentName] = useState('Yakub')
  const [saving, setSaving] = useState<string | null>(null)  // "nb-{id}" | "mo-{id}" | "undo-nb-{id}" | "undo-mo-{id}"
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
    if (tab === 'Night-Before Calls')  return !r.nb_outcome
    if (tab === 'Morning-Of Calls')    return !r.mo_outcome
    if (tab === 'Pending Calls')       return r.confirmation_status !== 'Confirmed' && r.confirmation_status !== 'confirmed'
    if (tab === 'No-Show Risk')        return r.no_show_risk === 'high'
    if (tab === 'Confirmed')           return r.confirmation_status === 'Confirmed' || r.confirmation_status === 'confirmed'
    return true
  })

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))

  async function recordCall(row: any, callType: 'night_before' | 'morning_of', outcome: string) {
    const key = `${callType === 'night_before' ? 'nb' : 'mo'}-${row.appointment_id}`
    setSaving(key)
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
    showToast(`Saved — ${outcomeLabel(outcome)}`)
    load()
  }

  async function reverseCall(row: any, callType: 'night_before' | 'morning_of') {
    const key = `undo-${callType === 'night_before' ? 'nb' : 'mo'}-${row.appointment_id}`
    setSaving(key)
    const { error } = await supabase.rpc('reverse_confirmation_call', {
      p_appointment_id: row.appointment_id,
      p_call_type:      callType,
      p_agent_name:     agentName,
    })
    setSaving(null)
    if (error) { showToast('Error: ' + error.message); return }
    showToast(`Call reversed`)
    load()
  }

  const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  function CallOutcomeCell({
    row,
    callType,
    outcome,
    agentVal,
    calledAt,
  }: {
    row: any
    callType: 'night_before' | 'morning_of'
    outcome: string | null
    agentVal: string | null
    calledAt: string | null
  }) {
    const undoKey = `undo-${callType === 'night_before' ? 'nb' : 'mo'}-${row.appointment_id}`
    const setKey  = `${callType === 'night_before' ? 'nb' : 'mo'}-${row.appointment_id}`
    const isUndoing = saving === undoKey
    const isSetting = saving === setKey

    if (outcome) {
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-1 flex-wrap">
            <span className={`text-[10px] rounded px-1.5 py-0.5 ${STATUS_BADGE[outcome] ?? 'bg-slate-100'}`}>
              {outcomeLabel(outcome)}
            </span>
            <button
              onClick={() => reverseCall(row, callType)}
              disabled={isUndoing}
              title="Undo this call — recorded by mistake"
              className="text-[10px] px-1.5 py-0.5 rounded border border-slate-300 text-slate-500
                         hover:bg-rose-50 hover:border-rose-300 hover:text-rose-600
                         transition-colors disabled:opacity-40"
            >
              {isUndoing ? '…' : '↩ Undo'}
            </button>
          </div>
          {agentVal && (
            <div className="text-[10px] text-slate-400">
              {agentVal}{calledAt ? ' ' + new Date(calledAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : ''}
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="flex flex-wrap gap-1">
        {OUTCOME_BUTTONS.slice(0, 4).map(b => (
          <button
            key={b.outcome}
            disabled={isSetting}
            onClick={() => recordCall(row, callType, b.outcome)}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-all ${b.tone} disabled:opacity-50`}
          >
            {b.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="relative bg-white rounded-xl border border-slate-200 flex flex-col h-full min-h-0">
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

      {/* Tabs + summary */}
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
            { l: 'Total',     v: rows.length,                                               tone: 'text-slate-800' },
            { l: 'Confirmed', v: rows.filter(r=>r.confirmation_status==='Confirmed').length, tone: 'text-emerald-600' },
            { l: 'Pending',   v: rows.filter(r=>r.confirmation_status!=='Confirmed').length, tone: 'text-amber-600' },
            { l: 'Risk',      v: rows.filter(r=>r.no_show_risk==='high').length,             tone: 'text-rose-600' },
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
          <div className="p-4 space-y-2">{[0,1,2].map(i=><div key={i} className="h-16 bg-slate-100 rounded animate-pulse"/>)}</div>
        ) : paginated.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">No appointments match this tab.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="px-2 py-2 font-medium whitespace-nowrap">Time</th>
                <th className="px-2 py-2 font-medium">Patient & Contact</th>
                <th className="px-2 py-2 font-medium">Doctor</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Night Before</th>
                <th className="px-2 py-2 font-medium">Morning Of</th>
                <th className="px-2 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginated.map(r => {
                // For imported appointments without a linked patient, parse info from notes
                const parsed = parseNotes(r.notes)
                const displayName = r.patient_name || parsed.display.split(' · ')[0] || 'Unknown'
                const displayPhone = r.phone || parsed.phone
                const displayReason = r.patient_name
                  ? r.notes  // real patient — notes are plain text
                  : parsed.display.includes('—') ? parsed.display.split('—').slice(1).join('—').trim() : r.notes

                return (
                  <tr key={r.appointment_id} className="hover:bg-slate-50">
                    <td className="px-2 py-2 font-medium text-slate-700 whitespace-nowrap align-top">{r.appointment_time || '—'}</td>
                    <td className="px-2 py-2 align-top">
                      <div className="font-medium text-slate-800 truncate max-w-[140px]">{displayName}</div>
                      {displayPhone && <div className="text-slate-400 text-[11px]">{displayPhone}</div>}
                      {r.hn && <div className="text-slate-400 text-[11px]">HN: {r.hn}</div>}
                      {displayReason && (
                        <div className="text-slate-400 text-[10px] max-w-[140px] truncate" title={displayReason}>
                          {displayReason}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-slate-600 align-top max-w-[100px]">
                      <div className="truncate">{(r.doctor_service || '—').replace('Dr. Chowdhury Rashedul','Dr. C.R.').replace('Dr. Muhammad Nazmul','Dr. Nazmul')}</div>
                      {r.service_type && <div className="text-[10px] text-slate-400 truncate">{r.service_type}</div>}
                    </td>
                    <td className="px-2 py-2 align-top">
                      <span className={`text-[10px] rounded px-1.5 py-0.5 ${STATUS_BADGE[r.appointment_status] ?? 'bg-slate-100 text-slate-500'}`}>
                        {r.appointment_status}
                      </span>
                      {r.no_show_risk && (
                        <div className="mt-0.5">
                          <span className={`text-[10px] rounded px-1.5 py-0.5 ${RISK_BADGE[r.no_show_risk]}`}>
                            {r.no_show_risk} risk
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 align-top min-w-[130px]">
                      <CallOutcomeCell
                        row={r}
                        callType="night_before"
                        outcome={r.nb_outcome}
                        agentVal={r.nb_agent}
                        calledAt={r.nb_called_at}
                      />
                    </td>
                    <td className="px-2 py-2 align-top min-w-[130px]">
                      <CallOutcomeCell
                        row={r}
                        callType="morning_of"
                        outcome={r.mo_outcome}
                        agentVal={r.mo_agent}
                        calledAt={r.mo_called_at}
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <div className="flex items-center gap-1 flex-wrap">
                        {(displayPhone || r.phone) && (
                          <a href={`tel:${displayPhone || r.phone}`}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 hover:bg-teal-200 transition-colors">
                            Call
                          </a>
                        )}
                        <button onClick={() => setQueueModal({ ...r, phone: displayPhone || r.phone })}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                          + Queue
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
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
              className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-slate-50">←</button>
            {Array.from({length: Math.min(totalPages, 5)}, (_,i) => i+1).map(p => (
              <button key={p} onClick={() => setPage(p)}
                className={`px-2 py-1 border rounded ${page===p ? 'bg-teal-600 text-white border-teal-600' : 'hover:bg-slate-50'}`}>{p}</button>
            ))}
            <button disabled={page===totalPages} onClick={() => setPage(p => p+1)}
              className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-slate-50">→</button>
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
        <div className="absolute bottom-4 right-4 bg-slate-900 text-white text-xs px-3 py-2 rounded-md shadow-lg z-20">
          {toast}
        </div>
      )}
    </div>
  )
}

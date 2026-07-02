'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import RescheduleModal from './RescheduleModal'
import { useDropdownOptions } from '@/hooks/useDropdownOptions'

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
  const [toast, setToast] = useState('')
  const [page, setPage] = useState(1)
  const [rescheduling, setRescheduling] = useState<any | null>(null)
  const PER_PAGE = 10
  const apptStatusOpts = useDropdownOptions('appointment_status')

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

  async function updateAppointmentStatus(appointmentId: number, status: string) {
    const { error } = await supabase.rpc('update_appointment_status', {
      p_appointment_id: appointmentId, p_status: status, p_confirmation_status: null, p_notes: null,
    })
    if (error) { showToast('Error: ' + error.message); return }
    showToast('Status updated.')
    load()
  }

  async function updateHospitalId(patientId: number, hospitalId: string) {
    const { error } = await supabase.rpc('update_hospital_patient_id', {
      p_patient_id: patientId, p_hospital_patient_id: hospitalId,
    })
    if (error) { showToast('Error: ' + error.message); return }
    showToast('Hospital ID updated.')
    load()
  }

  async function updatePatientInfo(patientId: number, fullName: string, phone: string) {
    const { error } = await supabase.from('patients').update({ full_name: fullName, phone }).eq('id', patientId)
    if (error) { showToast('Error: ' + error.message); return }
    showToast('Patient info updated.')
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
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-xs rounded px-2 py-1 ${STATUS_BADGE[outcome] ?? 'bg-slate-100'}`}>
              {outcomeLabel(outcome)}
            </span>
            <button
              onClick={() => reverseCall(row, callType)}
              disabled={isUndoing}
              title="Undo this call — recorded by mistake"
              className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-500
                         hover:bg-rose-50 hover:border-rose-300 hover:text-rose-600
                         transition-colors disabled:opacity-40"
            >
              {isUndoing ? '…' : '↩ Undo'}
            </button>
          </div>
          {agentVal && (
            <div className="text-xs text-slate-400">
              {agentVal}{calledAt ? ' ' + new Date(calledAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : ''}
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="flex flex-wrap gap-1.5">
        {OUTCOME_BUTTONS.slice(0, 4).map(b => (
          <button
            key={b.outcome}
            disabled={isSetting}
            onClick={() => recordCall(row, callType, b.outcome)}
            className={`text-xs px-2 py-1 rounded transition-all ${b.tone} disabled:opacity-50`}
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
            <div key={m.l} className="bg-slate-50 rounded-md p-2 text-center">
              <div className={`text-lg font-bold ${m.tone}`}>{m.v}</div>
              <div className="text-xs text-slate-400">{m.l}</div>
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
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Time</th>
                <th className="px-3 py-2.5 font-medium">Patient</th>
                <th className="px-3 py-2.5 font-medium">Phone</th>
                <th className="px-3 py-2.5 font-medium">Hospital ID</th>
                <th className="px-3 py-2.5 font-medium">Doctor</th>
                <th className="px-3 py-2.5 font-medium">Reason for Visit</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Night Before</th>
                <th className="px-3 py-2.5 font-medium">Morning Of</th>
                <th className="px-3 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginated.map(r => (
                <AppointmentRow
                  key={r.appointment_id}
                  r={r}
                  statusOpts={apptStatusOpts.options}
                  onUpdateStatus={updateAppointmentStatus}
                  onUpdateHospitalId={updateHospitalId}
                  onUpdatePatientInfo={updatePatientInfo}
                  onReschedule={() => setRescheduling(r)}
                  CallOutcomeCell={CallOutcomeCell}
                />
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

      {rescheduling && (
        <RescheduleModal
          appointment={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={() => { setRescheduling(null); showToast('Appointment rescheduled.'); load() }}
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

function AppointmentRow({
  r, statusOpts, onUpdateStatus, onUpdateHospitalId, onUpdatePatientInfo, onReschedule, CallOutcomeCell,
}: any) {
  const parsed = parseNotes(r.notes)
  const fallbackName = parsed.display.split(' · ')[0] || 'Unknown'
  const fallbackPhone = parsed.phone
  const displayReason = r.patient_name
    ? r.notes
    : parsed.display.includes('—') ? parsed.display.split('—').slice(1).join('—').trim() : r.notes

  const [status, setStatus] = useState(r.appointment_status || 'Booked')
  const [name, setName] = useState(r.patient_name || fallbackName)
  const [phone, setPhone] = useState(r.phone || fallbackPhone || '')
  const [hospitalId, setHospitalId] = useState(r.hospital_patient_id || '')

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-3 py-3 font-medium text-slate-700 whitespace-nowrap align-top">{r.appointment_time || '—'}</td>
      <td className="px-3 py-3 align-top">
        {r.patient_id ? (
          <input
            className="input w-36 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== r.patient_name && onUpdatePatientInfo(r.patient_id, name, phone)}
          />
        ) : (
          <div className="font-medium text-slate-800">{name}</div>
        )}
        {r.hn && <div className="text-slate-400 text-xs mt-0.5">HN: {r.hn}</div>}
      </td>
      <td className="px-3 py-3 align-top text-slate-600 whitespace-nowrap">
        {r.patient_id ? (
          <input
            className="input w-32 text-sm"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => phone !== r.phone && onUpdatePatientInfo(r.patient_id, name, phone)}
          />
        ) : (
          phone || '—'
        )}
      </td>
      <td className="px-3 py-3 align-top">
        <input
          className="input w-24 text-sm"
          value={hospitalId}
          onChange={(e) => setHospitalId(e.target.value)}
          onBlur={() => r.patient_id && hospitalId !== r.hospital_patient_id && onUpdateHospitalId(r.patient_id, hospitalId)}
        />
      </td>
      <td className="px-3 py-3 text-slate-600 align-top">
        <div>{(r.doctor_service || '—')}</div>
        {r.service_type && <div className="text-xs text-slate-400 mt-0.5">{r.service_type}</div>}
      </td>
      <td className="px-3 py-3 align-top text-slate-600 max-w-[280px]">
        {displayReason || '—'}
      </td>
      <td className="px-3 py-3 align-top">
        <select
          className="input text-xs py-1"
          value={status}
          onChange={(e) => { setStatus(e.target.value); onUpdateStatus(r.appointment_id, e.target.value) }}
        >
          {statusOpts.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {r.no_show_risk && (
          <div className="mt-1">
            <span className={`text-xs rounded px-1.5 py-0.5 ${RISK_BADGE[r.no_show_risk]}`}>
              {r.no_show_risk} risk
            </span>
          </div>
        )}
      </td>
      <td className="px-3 py-3 align-top min-w-[150px]">
        <CallOutcomeCell row={r} callType="night_before" outcome={r.nb_outcome} agentVal={r.nb_agent} calledAt={r.nb_called_at} />
      </td>
      <td className="px-3 py-3 align-top min-w-[150px]">
        <CallOutcomeCell row={r} callType="morning_of" outcome={r.mo_outcome} agentVal={r.mo_agent} calledAt={r.mo_called_at} />
      </td>
      <td className="px-3 py-3 align-top whitespace-nowrap">
        <button
          onClick={onReschedule}
          className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-purple-50 hover:border-purple-300 hover:text-purple-700 transition-colors"
        >
          Reschedule
        </button>
      </td>
    </tr>
  )
}

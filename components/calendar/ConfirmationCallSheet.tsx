'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import RescheduleModal from './RescheduleModal'
import { useDropdownOptions } from '@/hooks/useDropdownOptions'
import { appointmentTypeColor } from '@/lib/appointmentTypeColors'
import { useAuth } from '@/lib/AuthContext'
import { withRetry } from '@/lib/withTimeout'

const TABS = ['All Patients','Night-Before Calls','Morning-Of Calls','Pending Calls','No-Show Risk','Confirmed'] as const
type Tab = typeof TABS[number]

// Compact icon-only outcome buttons — full labels used to force these two
// call columns to wrap onto multiple lines and eat most of the table width.
const OUTCOME_BUTTONS = [
  { label: '✓',  title: 'Confirmed',    outcome: 'confirmed',        tone: 'bg-emerald-600 text-white hover:bg-emerald-700' },
  { label: '✗',  title: 'Not Reached',  outcome: 'not_reached',      tone: 'bg-slate-200 text-slate-700 hover:bg-slate-300' },
  { label: '⏳', title: 'Busy',         outcome: 'busy',             tone: 'bg-amber-100 text-amber-700 hover:bg-amber-200' },
  { label: '📵', title: 'Switched Off', outcome: 'switched_off',     tone: 'bg-slate-200 text-slate-600 hover:bg-slate-300' },
  { label: '↻',  title: 'Reschedule',   outcome: 'wants_reschedule', tone: 'bg-purple-100 text-purple-700 hover:bg-purple-200' },
  { label: '⊘',  title: 'Cancelled',    outcome: 'cancelled',        tone: 'bg-rose-100 text-rose-700 hover:bg-rose-200' },
  { label: '#',  title: 'Wrong Number', outcome: 'wrong_number',     tone: 'bg-rose-200 text-rose-700 hover:bg-rose-300' },
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

export default function ConfirmationCallSheet({
  date, doctorFilter, onClose,
}: { date: string; doctorFilter?: string; onClose: () => void }) {
  const [allRows, setAllRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('All Patients')
  const { profile } = useAuth()
  // Attribution is the actual logged-in user, not a pickable dropdown — the
  // server stamps the authenticated identity on every call regardless of
  // what's sent here, so this is just for display.
  const agentName = profile?.full_name || profile?.email || 'agent'
  const [saving, setSaving] = useState<string | null>(null)  // "nb-{id}" | "mo-{id}" | "undo-nb-{id}" | "undo-mo-{id}"
  const [toast, setToast] = useState('')
  const [page, setPage] = useState(1)
  const [rescheduling, setRescheduling] = useState<any | null>(null)
  const PER_PAGE = 10
  const apptStatusOpts = useDropdownOptions('appointment_status')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await withRetry(
        () => supabase
          .from('calendar_appointment_detail')
          .select('*')
          .eq('appointment_date', date)
          .neq('appointment_status', 'Cancelled')
          .order('appointment_time'),
        12000,
        2,
      )
      setAllRows(data || [])
    } catch (err) {
      console.error('[confirmation-call-sheet] load failed', err)
    }
    setLoading(false)
  }, [date])

  // Applied on top of the loaded day so the header dashboard, tabs, and
  // table all reflect the same doctor-filtered set as the calendar grid above.
  const rows = useMemo(
    () => (!doctorFilter || doctorFilter === 'all' ? allRows : allRows.filter(r => r.doctor_service === doctorFilter)),
    [allRows, doctorFilter]
  )

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [doctorFilter])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  // Service-type breakdown for the selected day — only types actually
  // present are shown, so this dashboard row shrinks/grows with the day's
  // real appointment mix instead of listing every possible type.
  const serviceTypeTotals = useMemo(() => {
    const totals: Record<string, number> = {}
    rows.forEach(r => {
      const type = r.service_type || 'Unspecified'
      totals[type] = (totals[type] || 0) + 1
    })
    return Object.entries(totals)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
  }, [rows])

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
    if (error) { showToast('Error: ' + error.message); throw error }
    showToast('Status updated.')
    load()
  }

  async function updatePatientHn(patientId: number, hn: string) {
    const { error } = await supabase.rpc('update_patient_hn', {
      p_patient_id: patientId, p_new_hn: hn,
    })
    if (error) { showToast('Error: ' + error.message); throw error }
    showToast('Patient ID saved.')
    load()
  }

  async function updatePatientInfo(patientId: number, fullName: string, phone: string) {
    const { error } = await supabase.rpc('update_patient_contact_info', {
      p_patient_id: patientId, p_full_name: fullName, p_phone: phone,
    })
    if (error) { showToast('Error: ' + error.message); throw error }
    showToast('Patient info updated.')
    load()
  }

  // For appointments with no linked patient yet ("Unknown"): editing name/phone/hn
  // here creates-or-matches a real patient and links it back to the appointment.
  async function linkPatient(appointmentId: number, fullName: string, phone: string, hn?: string) {
    const { error } = await supabase.rpc('link_or_update_appointment_patient', {
      p_appointment_id: appointmentId, p_full_name: fullName, p_phone: phone, p_hn: hn || null,
    })
    if (error) { showToast('Error: ' + error.message); throw error }
    showToast('Patient linked and saved.')
    load()
  }

  const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  // One compact row per call type (Night Before / Morning Of) — icon-only
  // outcome buttons so both fit on a single line inside one narrow column,
  // instead of the two separate wide columns of full-text buttons before.
  function CallOutcomeRow({
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
    const rowLabel = callType === 'night_before' ? 'NB' : 'MO'

    return (
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="text-[10px] font-semibold text-slate-400 w-5 shrink-0">{rowLabel}</span>
        {outcome ? (
          <>
            <span
              title={`${agentVal ?? ''}${calledAt ? ' · ' + new Date(calledAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}`}
              className={`text-[11px] rounded px-1.5 py-0.5 ${STATUS_BADGE[outcome] ?? 'bg-slate-100'}`}
            >
              {outcomeLabel(outcome)}
            </span>
            <button
              onClick={() => reverseCall(row, callType)}
              disabled={isUndoing}
              title="Undo this call — recorded by mistake"
              className="text-[11px] px-1 rounded border border-slate-300 text-slate-400
                         hover:bg-rose-50 hover:border-rose-300 hover:text-rose-600
                         transition-colors disabled:opacity-40 shrink-0"
            >
              {isUndoing ? '…' : '↩'}
            </button>
          </>
        ) : (
          <div className="flex gap-1">
            {OUTCOME_BUTTONS.slice(0, 4).map(b => (
              <button
                key={b.outcome}
                disabled={isSetting}
                title={b.title}
                onClick={() => recordCall(row, callType, b.outcome)}
                className={`text-[11px] leading-none w-5 h-5 flex items-center justify-center rounded transition-all ${b.tone} disabled:opacity-50`}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
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
          <span title="Confirmation calls are attributed to your logged-in account" className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-2 py-1">
            {agentName}
          </span>
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

        {/* Service-type dashboard for this day — dynamic, non-zero types only */}
        {serviceTypeTotals.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            {serviceTypeTotals.map(t => {
              const color = appointmentTypeColor(t.type)
              return (
                <span key={t.type} className={`text-xs rounded-full pl-1.5 pr-2 py-0.5 flex items-center gap-1 ${color.chip}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
                  {t.type}: <strong>{t.count}</strong>
                </span>
              )
            })}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="p-4 space-y-2">{[0,1,2].map(i=><div key={i} className="h-16 bg-slate-100 rounded animate-pulse"/>)}</div>
        ) : paginated.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">No appointments match this tab.</p>
        ) : (
          <table className="w-full text-sm min-w-[900px] border-collapse">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr className="text-left text-slate-500">
                <th className="px-2 py-2.5 font-medium whitespace-nowrap border border-slate-200">Time</th>
                <th className="px-2 py-2.5 font-medium border border-slate-200">Patient</th>
                <th className="px-2 py-2.5 font-medium border border-slate-200">Phone</th>
                <th className="px-2 py-2.5 font-medium border border-slate-200">Hosp. ID</th>
                <th className="px-2 py-2.5 font-medium border border-slate-200">Doctor</th>
                <th className="px-2 py-2.5 font-medium border border-slate-200">Service Type</th>
                <th className="px-2 py-2.5 font-medium border border-slate-200">Reason</th>
                <th className="px-2 py-2.5 font-medium border border-slate-200">Status</th>
                <th className="px-2 py-2.5 font-medium border border-slate-200">Doctor Availability</th>
                <th className="px-2 py-2.5 font-medium border border-slate-200">Confirmation Calls</th>
                <th className="px-2 py-2.5 font-medium border border-slate-200"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginated.map(r => (
                <AppointmentRow
                  key={r.appointment_id}
                  r={r}
                  statusOpts={apptStatusOpts.options}
                  onUpdateStatus={updateAppointmentStatus}
                  onUpdatePatientHn={updatePatientHn}
                  onUpdatePatientInfo={updatePatientInfo}
                  onLinkPatient={linkPatient}
                  onReschedule={() => setRescheduling(r)}
                  CallOutcomeRow={CallOutcomeRow}
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

// Short relative-time label ("2m ago", "3h ago", "5d ago") for attribution
// lines — precise enough for "who touched this recently" without a full
// timestamp cluttering the row.
function relTime(iso: string | null): string {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// Auto-sync writes are tagged internally with these system identifiers
// rather than a person's name — shown with a distinct icon/label so staff
// can tell "an invoice corrected this" apart from a colleague's edit.
const SYSTEM_ATTRIBUTION_LABEL: Record<string, string> = {
  invoice_auto_sync: 'Invoice match (admin recompute)',
  invoice_auto_sync_cron: 'Invoice match (nightly sync)',
  invoice_sync: 'Invoice match (admin recompute)',
}

// Small "Confirmed by X · time" line shown under a field once it has an
// attributed edit — the same value the KPI dashboard's Field Confirmations
// panel counts, so what an agent sees here matches what admins see there.
function Attribution({ by, at }: { by: string | null; at: string | null }) {
  if (!by) return null
  const isSystem = by in SYSTEM_ATTRIBUTION_LABEL
  const label = SYSTEM_ATTRIBUTION_LABEL[by] || by
  return (
    <div
      className={`text-[10px] mt-0.5 truncate ${isSystem ? 'text-sky-600' : 'text-slate-400'}`}
      title={at ? new Date(at).toLocaleString() : undefined}
    >
      {isSystem ? '🧾 ' : 'by '}{label}{at ? ` · ${relTime(at)}` : ''}
    </div>
  )
}

function AppointmentRow({
  r, statusOpts, onUpdateStatus, onUpdatePatientHn, onUpdatePatientInfo, onLinkPatient, onReschedule, CallOutcomeRow,
}: any) {
  // Safety net: strip a lingering "Name · Location · +Phone — reason" prefix
  // if any notes weren't cleaned server-side, so only the actual reason shows.
  const rawNotes = r.notes || ''
  const legacyMatch = rawNotes.match(/^.*·.*·.*\+\d{10,15}.*—\s*(.*)$/)
  const displayReason = legacyMatch ? legacyMatch[1].trim() : rawNotes

  const [status, setStatus] = useState(r.appointment_status || 'Booked')
  const [name, setName] = useState(r.patient_name || '')
  const [phone, setPhone] = useState(r.phone || '')
  const hasRealHn = !!r.hn && !r.hn.startsWith('APP-')
  const [hnInput, setHnInput] = useState(hasRealHn ? r.hn : '')

  const [savingStatus, setSavingStatus] = useState(false)
  const [savingContact, setSavingContact] = useState(false)
  const [savingHn, setSavingHn] = useState(false)

  // Invoice-matched records are locked: the invoice is the source of truth
  // and always wins over a manual edit, so once it has corrected a field
  // there's nothing for a human edit to accomplish except create a
  // discrepancy the next sync will immediately overwrite anyway.
  const patientLocked = r.patient_updated_by in SYSTEM_ATTRIBUTION_LABEL
  const statusLocked = r.status_updated_by in SYSTEM_ATTRIBUTION_LABEL && status === 'Confirmed'

  const statusDirty = !statusLocked && status !== (r.appointment_status || 'Booked')
  const contactDirty = !patientLocked && (name !== (r.patient_name || '') || phone !== (r.phone || ''))
  const hnDirty = !patientLocked && !hasRealHn && hnInput && hnInput !== (r.hn || '')

  async function confirmStatus() {
    setSavingStatus(true)
    try { await onUpdateStatus(r.appointment_id, status) } catch { setStatus(r.appointment_status || 'Booked') }
    setSavingStatus(false)
  }

  async function confirmContact() {
    setSavingContact(true)
    try {
      if (r.patient_id) await onUpdatePatientInfo(r.patient_id, name, phone)
      else await onLinkPatient(r.appointment_id, name, phone, hasRealHn ? r.hn : hnInput)
    } catch { /* toast already shown by handler */ }
    setSavingContact(false)
  }

  async function confirmHn() {
    setSavingHn(true)
    try {
      if (r.patient_id) await onUpdatePatientHn(r.patient_id, hnInput)
      else await onLinkPatient(r.appointment_id, name, phone, hnInput)
    } catch { /* toast already shown by handler */ }
    setSavingHn(false)
  }

  const serviceColor = appointmentTypeColor(r.service_type || 'Unspecified')

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-2 py-2.5 font-medium text-slate-700 whitespace-nowrap align-top border border-slate-100">{r.appointment_time || '—'}</td>
      <td className="px-2 py-2.5 align-top border border-slate-100">
        {patientLocked && (
          <div className="text-[10px] font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded px-1.5 py-0.5 mb-1 inline-flex items-center gap-1" title="Patient name, phone, and Hospital ID were corrected from a matched invoice and are locked — the invoice is the source of truth.">
            🧾 Invoice found — locked
          </div>
        )}
        <div className="flex items-center gap-1">
          <input
            className={`input w-32 text-sm ${patientLocked ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`}
            value={name}
            placeholder="Patient name"
            disabled={patientLocked}
            onChange={(e) => setName(e.target.value)}
          />
          {contactDirty && (
            <button
              onClick={confirmContact}
              disabled={savingContact}
              title="Confirm name/phone change"
              className="text-xs w-5 h-5 flex items-center justify-center rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 shrink-0"
            >
              {savingContact ? '…' : '✓'}
            </button>
          )}
        </div>
        <Attribution by={r.patient_updated_by} at={r.patient_updated_at} />
      </td>
      <td className="px-2 py-2.5 align-top text-slate-600 whitespace-nowrap border border-slate-100">
        <div className="flex items-center gap-1">
          <input
            className={`input w-28 text-sm ${patientLocked ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`}
            value={phone}
            placeholder="Phone"
            disabled={patientLocked}
            onChange={(e) => setPhone(e.target.value)}
          />
          {contactDirty && (
            <button
              onClick={confirmContact}
              disabled={savingContact}
              title="Confirm name/phone change"
              className="text-xs w-5 h-5 flex items-center justify-center rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 shrink-0"
            >
              {savingContact ? '…' : '✓'}
            </button>
          )}
        </div>
      </td>
      <td className="px-2 py-2.5 align-top border border-slate-100">
        {hasRealHn ? (
          <span className="text-slate-700 text-xs font-mono">{r.hn}</span>
        ) : (
          <div className="flex items-center gap-1">
            <input
              className={`input w-20 text-sm ${patientLocked ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`}
              placeholder="Enter ID"
              value={hnInput}
              disabled={patientLocked}
              onChange={(e) => setHnInput(e.target.value)}
            />
            {hnDirty && (
              <button
                onClick={confirmHn}
                disabled={savingHn}
                title="Confirm Hospital ID"
                className="text-xs w-5 h-5 flex items-center justify-center rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 shrink-0"
              >
                {savingHn ? '…' : '✓'}
              </button>
            )}
          </div>
        )}
        <Attribution by={r.patient_updated_by} at={r.patient_updated_at} />
      </td>
      <td className="px-2 py-2.5 text-slate-600 align-top max-w-[110px] break-words border border-slate-100" title={r.doctor_service || ''}>
        {(r.doctor_service || '—')}
      </td>
      <td className="px-2 py-2.5 align-top border border-slate-100">
        <span className={`inline-flex items-center gap-1 text-xs rounded-full pl-1.5 pr-2 py-0.5 break-words ${serviceColor.chip}`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${serviceColor.dot}`} />
          {r.service_type || 'Unspecified'}
        </span>
      </td>
      <td className="px-2 py-2.5 align-top text-slate-600 max-w-[140px] break-words border border-slate-100" title={displayReason || ''}>
        {displayReason || '—'}
      </td>
      <td className="px-2 py-2.5 align-top border border-slate-100">
        <div className="flex items-center gap-1">
          <select
            className={`input text-xs py-1 ${statusLocked ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`}
            value={status}
            disabled={statusLocked}
            onChange={(e) => setStatus(e.target.value)}
            title={statusLocked ? 'Confirmed by a matched invoice — locked, since the invoice is the source of truth.' : undefined}
          >
            {statusOpts.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {statusDirty && (
            <>
              <button
                onClick={confirmStatus}
                disabled={savingStatus}
                title="Confirm status change"
                className="text-xs w-5 h-5 flex items-center justify-center rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 shrink-0"
              >
                {savingStatus ? '…' : '✓'}
              </button>
              <button
                onClick={() => setStatus(r.appointment_status || 'Booked')}
                disabled={savingStatus}
                title="Discard status change"
                className="text-xs w-5 h-5 flex items-center justify-center rounded border border-slate-300 text-slate-400 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-600 disabled:opacity-40 shrink-0"
              >
                ✕
              </button>
            </>
          )}
        </div>
        <Attribution by={r.status_updated_by} at={r.status_updated_at} />
        {r.no_show_risk && (
          <div className="mt-1">
            <span className={`text-xs rounded px-1.5 py-0.5 ${RISK_BADGE[r.no_show_risk]}`}>
              {r.no_show_risk} risk
            </span>
          </div>
        )}
      </td>
      <td className="px-2 py-2.5 align-top max-w-[160px] border border-slate-100">
        {r.doctor_availability_conflict ? (
          <span
            className="text-xs rounded px-1.5 py-0.5 bg-amber-100 text-amber-800 inline-block break-words"
            title="Front desk changed this doctor's availability for this date — reschedule this patient."
          >
            ⚠ {r.doctor_availability_conflict}
          </span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </td>
      <td className="px-2 py-2.5 align-top min-w-[170px] border border-slate-100">
        <div className="space-y-1">
          <CallOutcomeRow row={r} callType="night_before" outcome={r.nb_outcome} agentVal={r.nb_agent} calledAt={r.nb_called_at} />
          <CallOutcomeRow row={r} callType="morning_of" outcome={r.mo_outcome} agentVal={r.mo_agent} calledAt={r.mo_called_at} />
        </div>
      </td>
      <td className="px-2 py-2.5 align-top whitespace-nowrap border border-slate-100">
        <button
          onClick={onReschedule}
          title="Reschedule"
          className="text-xs w-6 h-6 flex items-center justify-center rounded border border-slate-300 text-slate-600 hover:bg-purple-50 hover:border-purple-300 hover:text-purple-700 transition-colors"
        >
          ↻
        </button>
      </td>
    </tr>
  )
}

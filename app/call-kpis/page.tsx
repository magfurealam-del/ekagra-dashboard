'use client'
export const dynamic = 'force-dynamic'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useVisibilityReload } from '@/hooks/useVisibilityReload'
import { supabase } from '@/lib/supabase'
import { withRetry } from '@/lib/withTimeout'
import { KPICard, BarList, Panel } from '@/components/admin/DashboardCharts'
import CallTrendChart from '@/components/callkpis/CallTrendChart'
import { OUTCOMES } from '@/components/outgoing-calls/types'

type RangeKey = 'today' | '7d' | '30d' | 'month' | 'custom'

// Module-level cache so switching tabs doesn't re-fetch if data is fresh
const kpiCache: { key: string; data: any; fetchedAt: number } = { key: '', data: null, fetchedAt: 0 }
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

function toISO(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

function rangeFor(key: RangeKey, customStart: string, customEnd: string) {
  const today = new Date()
  if (key === 'today') return { start: toISO(today), end: toISO(today) }
  if (key === '7d') { const s = new Date(today); s.setDate(s.getDate() - 6); return { start: toISO(s), end: toISO(today) } }
  if (key === '30d') { const s = new Date(today); s.setDate(s.getDate() - 29); return { start: toISO(s), end: toISO(today) } }
  if (key === 'month') { const s = new Date(today.getFullYear(), today.getMonth(), 1); return { start: toISO(s), end: toISO(today) } }
  return { start: customStart, end: customEnd }
}

const OUTGOING_OUTCOME_LABEL: Record<string, string> = {
  reached: 'Reached',
  not_reached: 'Not Reached',
  busy: 'Busy',
  switched_off: 'Switched Off',
  wrong_number: 'Wrong Number',
  booked_appointment: 'Booked Appointment',
  already_visited: 'Already Visited',
  not_interested: 'Not Interested',
  call_later: 'Call Later',
  do_not_call: 'Do Not Call',
  unspecified: 'Unspecified',
}

const INCOMING_OUTCOME_COLORS: Record<string, string> = {
  'Appointment Booked': 'bg-teal-500',
  'No Appointment Yet': 'bg-amber-500',
  'No-show': 'bg-rose-500',
  'Not Interested': 'bg-slate-400',
  'General Inquiry': 'bg-sky-500',
}

const OUTGOING_OUTCOME_COLORS: Record<string, string> = {
  'Reached': 'bg-emerald-500',
  'Booked Appointment': 'bg-teal-500',
  'Not Reached': 'bg-slate-400',
  'Busy': 'bg-amber-500',
  'Switched Off': 'bg-slate-400',
  'Wrong Number': 'bg-rose-500',
  'Already Visited': 'bg-indigo-400',
  'Not Interested': 'bg-slate-400',
  'Call Later': 'bg-sky-500',
  'Do Not Call': 'bg-rose-600',
}

const CONFIRMATION_OUTCOME_COLORS: Record<string, string> = {
  'Confirmed': 'bg-emerald-500',
  'Not Reached': 'bg-slate-400',
  'Busy': 'bg-amber-500',
  'Switched Off': 'bg-slate-400',
  'Wants Reschedule': 'bg-purple-500',
  'Cancelled': 'bg-rose-500',
  'Wrong Number': 'bg-rose-600',
}

const DIRECTION_BADGE: Record<string, string> = {
  'Incoming': 'bg-teal-100 text-teal-700',
  'Outgoing': 'bg-indigo-100 text-indigo-700',
  'Confirmation - Night Before': 'bg-purple-100 text-purple-700',
  'Confirmation - Morning Of': 'bg-sky-100 text-sky-700',
}

// Source badge colors — lead sources reuse the same palette as the Admin
// Dashboard's "Lead Source" panel so the two stay visually consistent;
// outgoing follow-up categories and confirmation calls get their own
// distinct hues so all three directions are identifiable at a glance.
const SOURCE_BADGE: Record<string, string> = {
  'Facebook': 'bg-blue-100 text-blue-700',
  'Referral': 'bg-emerald-100 text-emerald-700',
  'Phone / Hotline': 'bg-amber-100 text-amber-700',
  'Walk-in': 'bg-purple-100 text-purple-700',
  'Unknown': 'bg-slate-100 text-slate-500',
  'No-show Follow-up': 'bg-rose-100 text-rose-700',
  'Surgery Follow-up': 'bg-orange-100 text-orange-700',
  'Healing Follow-up': 'bg-orange-50 text-orange-600',
  'Wound Care Lead': 'bg-sky-100 text-sky-700',
  'Screening Lead': 'bg-indigo-100 text-indigo-700',
  'Appointment Confirmation': 'bg-fuchsia-100 text-fuchsia-700',
}

type InvoiceMatch = {
  status: 'matched' | 'missing'
  method: string | null
  invoice_no: string | null
  invoice_date: string | null
} | null

const PATIENT_TYPE_BADGE: Record<string, string> = {
  'New': 'bg-teal-100 text-teal-700',
  'Old': 'bg-indigo-100 text-indigo-700',
  'Unknown': 'bg-slate-100 text-slate-500',
}

type CallLogRow = {
  attempt_id: number | null
  call_date: string
  direction: string
  source: string | null
  patient_name: string | null
  patient_type: string | null
  phone: string | null
  agent: string | null
  outcome: string | null
  outcome_code: string | null
  notes: string | null
  hospital_id: string | null
  location: string | null
  doctor_service: string | null
  appointment_date: string | null
  appointment_time: string | null
  patient_id?: number | null
  invoice_check_date?: string | null
  invoice_match?: InvoiceMatch
  details: Record<string, string | number | null> | null
}

function MiniCallCalendar({
  trend,
  selectedDate,
  onSelect,
}: {
  trend: { date: string; incoming?: number; outgoing?: number; confirmation?: number }[]
  selectedDate: string | null
  onSelect: (date: string) => void
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1).getDay()
  const trendByDate = new Map(trend.map(d => [d.date, (d.incoming || 0) + (d.outgoing || 0) + (d.confirmation || 0)]))
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, i) => i < firstDay ? null : i - firstDay + 1)
  const dateForDay = (day: number) => `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  return (
    <div className="border border-slate-200 rounded-xl bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Call calendar</h2>
          <p className="text-[11px] text-slate-400">Click a day to filter the dashboard</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
          <span className="text-xs font-medium min-w-[105px] text-center">{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
          <button className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="text-[10px] text-slate-400 py-1">{d}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={`blank-${i}`} />
          const date = dateForDay(day)
          const count = trendByDate.get(date) || 0
          const isSelected = selectedDate === date
          const isToday = date === toISO(new Date())
          return (
            <button key={date} onClick={() => onSelect(date)} className={`min-h-[38px] rounded-md border text-xs transition-colors ${isSelected ? 'bg-teal-600 text-white border-teal-600' : isToday ? 'border-teal-400 bg-teal-50' : 'border-slate-100 hover:bg-slate-50'}`}>
              <div>{day}</div>
              {count > 0 && <div className={`text-[10px] font-semibold ${isSelected ? 'text-white' : 'text-indigo-600'}`}>{count}</div>}
            </button>
          )
        })}
      </div>
      <div className="mt-2 text-[10px] text-slate-400">Numbers show total calls logged that day.</div>
    </div>
  )
}

// Merges every outcome-color map into one lookup so a single Outcome cell
// can be colored regardless of which direction (incoming/outgoing/
// confirmation) it came from — falls back to a neutral badge otherwise.
const OUTCOME_BADGE: Record<string, string> = {
  'Appointment Booked': 'bg-teal-100 text-teal-700',
  'No Appointment Yet': 'bg-amber-100 text-amber-700',
  'No-show': 'bg-rose-100 text-rose-700',
  'Not Interested': 'bg-slate-200 text-slate-600',
  'General Inquiry': 'bg-sky-100 text-sky-700',
  'Reached': 'bg-emerald-100 text-emerald-700',
  'Not Reached': 'bg-slate-200 text-slate-600',
  'Busy': 'bg-amber-100 text-amber-700',
  'Switched Off': 'bg-slate-200 text-slate-600',
  'Wrong Number': 'bg-rose-100 text-rose-700',
  'Already Visited': 'bg-indigo-100 text-indigo-700',
  'Call Later': 'bg-sky-100 text-sky-700',
  'Do Not Call': 'bg-rose-200 text-rose-700',
  'Confirmed': 'bg-emerald-100 text-emerald-700',
  'Wants Reschedule': 'bg-purple-100 text-purple-700',
  'Cancelled': 'bg-rose-100 text-rose-700',
}

const DETAIL_FIELD_LABEL: Record<string, string> = {
  hospital_id: 'Hospital ID',
  source: 'Source',
  campaign: 'Campaign',
  referral_name: 'Referral',
  patient_type: 'Patient Type',
  main_problem: 'Main Concern',
  lead_bucket: 'Lead Bucket',
  urgency: 'Urgency',
  priority: 'Priority',
  diabetes_status: 'Diabetes Status',
  location: 'Location',
  category: 'Category',
  reason: 'Reason',
  followup_number: 'Follow-up #',
  scheduled_date: 'Scheduled Date',
  appointment_date: 'Appointment Date',
  appointment_time: 'Appointment Time',
  doctor_service: 'Doctor / Service',
  appointment_type: 'Appointment Type',
  attempt_number: 'Attempt #',
}

type SortKey = 'call_date' | 'patient_name' | 'direction' | 'source' | 'agent' | 'outcome'

export default function CallKpisPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('today')
  const [customStart, setCustomStart] = useState(toISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [customEnd, setCustomEnd] = useState(toISO(new Date()))
  const { start, end } = useMemo(() => rangeFor(rangeKey, customStart, customEnd), [rangeKey, customStart, customEnd])

  const [metrics, setMetrics] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null)

  const [sortKey, setSortKey] = useState<SortKey>('call_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [directionFilter, setDirectionFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const [invoiceMatches, setInvoiceMatches] = useState<Record<number, InvoiceMatch | null>>({})
  const [invoiceLoading, setInvoiceLoading] = useState<number | null>(null)
  const selectedDate = rangeKey === 'custom' && customStart === customEnd ? customStart : null

  // Outcome correction state (per-row index in current callLog)
  const [correctingRow, setCorrectingRow] = useState<number | null>(null)
  const [correctCode, setCorrectCode] = useState('')
  const [correctNotes, setCorrectNotes] = useState('')
  const [correctState, setCorrectState] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [correctError, setCorrectError] = useState('')

  function openCorrection(i: number, currentCode: string | null, currentNotes: string | null) {
    setCorrectingRow(i)
    setCorrectCode(currentCode || '')
    setCorrectNotes(currentNotes || '')
    setCorrectState('idle')
    setCorrectError('')
  }

  async function saveCorrection(attemptId: number) {
    if (!correctCode) { setCorrectError('Please select an outcome.'); return }
    setCorrectState('saving')
    setCorrectError('')
    const { data, error } = await supabase.rpc('correct_call_attempt_outcome', {
      p_attempt_id: attemptId,
      p_outcome_code: correctCode,
      p_notes: correctNotes || null,
    })
    if (error || data?.error) {
      setCorrectState('error')
      setCorrectError(error?.message || data?.error || 'Save failed.')
      return
    }
    setCorrectState('success')
    setTimeout(() => {
      setCorrectingRow(null)
      fetchKpis(start, end, true)
    }, 800)
  }

  async function fetchKpis(start: string, end: string, force = false) {
    const cacheKey = `${start}|${end}`
    if (!force && kpiCache.key === cacheKey && Date.now() - kpiCache.fetchedAt < CACHE_TTL_MS) {
      setMetrics(kpiCache.data)
      setLastFetchedAt(kpiCache.fetchedAt)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data, error } = await withRetry(
        () => supabase.rpc('get_call_center_kpis_fast', { p_start_date: start, p_end_date: end }),
        15000,
        2,
      )
      if (error) { setError(error.message); setLoading(false); return }
      kpiCache.key = cacheKey
      kpiCache.data = data
      kpiCache.fetchedAt = Date.now()
      setMetrics(data)
      setLastFetchedAt(kpiCache.fetchedAt)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load KPI data. Please retry.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const cacheKey = `${start}|${end}`
      if (kpiCache.key === cacheKey && Date.now() - kpiCache.fetchedAt < CACHE_TTL_MS) {
        if (!cancelled) {
          setMetrics(kpiCache.data)
          setLastFetchedAt(kpiCache.fetchedAt)
          setLoading(false)
        }
        return
      }
      setLoading(true)
      setError('')
      try {
        const { data, error } = await withRetry(
          () => supabase.rpc('get_call_center_kpis_fast', { p_start_date: start, p_end_date: end }),
          8000,
          0,
        )
        if (cancelled) return
        if (error) { setError(error.message); setLoading(false); return }
        kpiCache.key = cacheKey
        kpiCache.data = data
        kpiCache.fetchedAt = Date.now()
        setMetrics(data)
        setLastFetchedAt(kpiCache.fetchedAt)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load KPI data. Please retry.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [start, end])

  useVisibilityReload(() => fetchKpis(start, end, true))

  async function expandCallRow(index: number, row: CallLogRow) {
    const isOpen = expandedRow === index
    setExpandedRow(isOpen ? null : index)
    if (isOpen || invoiceMatches[index] !== undefined || !row.patient_id || !row.invoice_check_date) return

    setInvoiceLoading(index)
    try {
      const { data, error } = await withRetry(
        () => supabase.rpc('get_call_kpi_invoice_match', {
          p_patient_id: row.patient_id,
          p_appointment_date: row.invoice_check_date,
        }),
        10000,
        1,
      )
      if (error) throw error
      setInvoiceMatches((current) => ({ ...current, [index]: data as InvoiceMatch }))
    } catch (error) {
      setInvoiceMatches((current) => ({ ...current, [index]: null }))
      console.error('[call-kpis] invoice match load failed', error)
    } finally {
      setInvoiceLoading(null)
    }
  }

  const outgoingOutcomeItems = (metrics?.by_outgoing_outcome || []).map((s: any) => ({
    label: OUTGOING_OUTCOME_LABEL[s.outcome] || s.outcome,
    count: s.count,
  }))

  // Per-agent tally with a blended conversion rate across every call type
  // that can lead to a booking (incoming intake + outgoing follow-up).
  const agentTally = (metrics?.by_agent || []).map((a: any) => {
    const totalCalls = a.incoming + a.outgoing + a.confirmation
    const bookableCalls = a.incoming + a.outgoing
    const bookings = (a.incoming_booked || 0) + (a.outgoing_booked || 0)
    const conversionRate = bookableCalls > 0 ? Math.round((bookings / bookableCalls) * 100) : null
    const confirmationRate = a.confirmation > 0 ? Math.round((a.confirmation_confirmed / a.confirmation) * 100) : null
    return { ...a, totalCalls, bookings, conversionRate, confirmationRate }
  }).sort((x: any, y: any) => y.totalCalls - x.totalCalls)

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'call_date' ? 'desc' : 'asc')
    }
  }

  const callLog: CallLogRow[] = useMemo(() => {
    let rows: CallLogRow[] = metrics?.call_log || []
    if (directionFilter !== 'all') rows = rows.filter(r => r.direction === directionFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(r =>
        (r.patient_name || '').toLowerCase().includes(q) ||
        (r.phone || '').toLowerCase().includes(q) ||
        (r.agent || '').toLowerCase().includes(q)
      )
    }
    const sorted = [...rows].sort((a, b) => {
      const av = (a[sortKey] || '') as string
      const bv = (b[sortKey] || '') as string
      if (sortKey === 'call_date') return new Date(av).getTime() - new Date(bv).getTime()
      return av.localeCompare(bv)
    })
    if (sortDir === 'desc') sorted.reverse()
    return sorted
  }, [metrics, directionFilter, search, sortKey, sortDir])

  function SortHeader({ label, k }: { label: string; k: SortKey }) {
    return (
      <th className="text-left py-1 cursor-pointer select-none hover:text-slate-600 border border-slate-200 px-2" onClick={() => toggleSort(k)}>
        {label}{sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
      </th>
    )
  }

  return (
    <div className="space-y-4 pb-20">
      <MiniCallCalendar
        trend={metrics?.daily_trend || []}
        selectedDate={selectedDate}
        onSelect={(date) => { setCustomStart(date); setCustomEnd(date); setRangeKey('custom') }}
      />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Call Center KPIs</h1>
          <p className="text-sm text-slate-500">Incoming (lead intake) and outgoing (follow-up) call volume and outcomes, per agent</p>
          {lastFetchedAt && (
            <p className="text-xs text-slate-400 mt-0.5">
              Last updated {Math.round((Date.now() - lastFetchedAt) / 60000) || '<1'} min ago ·{' '}
              <button
                className="underline hover:text-slate-600"
                onClick={() => fetchKpis(start, end, true)}
              >
                Refresh
              </button>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {([
            { key: 'today', label: 'Today' },
            { key: '7d', label: 'Last 7 Days' },
            { key: '30d', label: 'Last 30 Days' },
            { key: 'month', label: 'This Month' },
            { key: 'custom', label: 'Custom' },
          ] as { key: RangeKey; label: string }[]).map(r => (
            <button
              key={r.key}
              onClick={() => setRangeKey(r.key)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${rangeKey === r.key ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {r.label}
            </button>
          ))}
          {rangeKey === 'custom' && (
            <div className="flex items-center gap-1">
              <input type="date" className="input py-1.5 text-xs" value={customStart} onChange={e => setCustomStart(e.target.value)} />
              <span className="text-slate-400 text-xs">to</span>
              <input type="date" className="input py-1.5 text-xs" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-md p-3">{error}</div>}

      {loading || !metrics ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2].map(i => <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard label="Incoming Calls" value={metrics.incoming_total} tone="text-teal-600"
              tooltip="Calls received and logged via Lead Intake during this period." />
            <KPICard label="Outgoing Calls Made" value={metrics.outgoing_total} tone="text-indigo-600"
              tooltip="Outbound follow-up calls actually attempted (outcome recorded) in this period, from the Outgoing Call Sheet." />
            <KPICard label="Confirmation Calls" value={metrics.confirmation_total} tone="text-purple-600"
              tooltip="Night-before and morning-of appointment confirmation calls logged from the Calendar during this period." />
            <KPICard label="Outgoing Pending" value={metrics.outgoing_pending} tone="text-amber-600"
              tooltip="Snapshot right now (not date-range filtered): open items still waiting in the outgoing call queue." />
          </div>

          <Panel title="Daily Call Volume" subtitle="Incoming, outgoing, and confirmation calls, per day">
            <CallTrendChart data={metrics.daily_trend || []} />
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title="Incoming Call Outcomes" subtitle="What happened on the intake call itself">
              <BarList
                items={(metrics.by_incoming_outcome || []).map((s: any) => ({ label: s.outcome, count: s.count }))}
                colorFor={(label) => INCOMING_OUTCOME_COLORS[label] || 'bg-slate-400'}
              />
            </Panel>
            <Panel title="Outgoing Call Outcomes" subtitle="Result of each attempted follow-up call">
              <BarList
                items={outgoingOutcomeItems}
                colorFor={(label) => OUTGOING_OUTCOME_COLORS[label] || 'bg-slate-400'}
              />
            </Panel>
            <Panel title="Confirmation Call Outcomes" subtitle="Night-before / morning-of calls from the Calendar">
              <BarList
                items={(metrics.by_confirmation_outcome || []).map((s: any) => ({ label: s.outcome, count: s.count }))}
                colorFor={(label) => CONFIRMATION_OUTCOME_COLORS[label] || 'bg-slate-400'}
              />
            </Panel>
          </div>

          <Panel title="Agent Tally" subtitle="Total calls handled and blended conversion rate, per agent, for the selected period">
            {agentTally.length === 0 ? (
              <p className="text-sm text-slate-400">No agent-attributed calls this period.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {agentTally.map((a: any) => (
                  <div key={a.agent} className="border border-slate-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-slate-800 text-sm">{a.agent}</span>
                      <span className="text-xs text-slate-400">{a.totalCalls} call{a.totalCalls === 1 ? '' : 's'}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center mb-2">
                      <div>
                        <div className="text-base font-bold text-teal-600">{a.incoming}</div>
                        <div className="text-[10px] text-slate-400">Incoming</div>
                      </div>
                      <div>
                        <div className="text-base font-bold text-indigo-600">{a.outgoing}</div>
                        <div className="text-[10px] text-slate-400">Outgoing</div>
                      </div>
                      <div>
                        <div className="text-base font-bold text-purple-600">{a.confirmation}</div>
                        <div className="text-[10px] text-slate-400">Confirmation</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs border-t border-slate-100 pt-2">
                      <span className="text-slate-500" title="Bookings (incoming + outgoing) ÷ incoming + outgoing calls">
                        Conversion: <strong className="text-emerald-600">{a.conversionRate != null ? `${a.conversionRate}%` : '—'}</strong>
                      </span>
                      {a.confirmation > 0 && (
                        <span className="text-slate-500" title="Confirmed ÷ confirmation calls attempted">
                          Confirmed: <strong className="text-emerald-600">{a.confirmationRate != null ? `${a.confirmationRate}%` : '—'}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Agent Performance" subtitle="Incoming, outgoing, and confirmation call volume, per agent">
            {(metrics.by_agent || []).length === 0 ? (
              <p className="text-sm text-slate-400">No agent-attributed calls this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-400 uppercase">
                  <tr>
                    <th className="text-left py-1" rowSpan={2}>Agent</th>
                    <th className="text-center py-1 border-l border-slate-100" colSpan={2}>Incoming</th>
                    <th className="text-center py-1 border-l border-slate-100" colSpan={3}>Outgoing</th>
                    <th className="text-center py-1 border-l border-slate-100" colSpan={2}>Confirmation</th>
                  </tr>
                  <tr>
                    <th className="text-right py-1 border-l border-slate-100 font-normal">Total</th>
                    <th className="text-right py-1 font-normal">Booked</th>
                    <th className="text-right py-1 border-l border-slate-100 font-normal">Total</th>
                    <th className="text-right py-1 font-normal">Reached</th>
                    <th className="text-right py-1 font-normal">Booked</th>
                    <th className="text-right py-1 border-l border-slate-100 font-normal">Total</th>
                    <th className="text-right py-1 font-normal">Confirmed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(metrics.by_agent || []).map((a: any) => (
                    <tr key={a.agent}>
                      <td className="py-1.5">{a.agent}</td>
                      <td className="py-1.5 text-right border-l border-slate-100">{a.incoming}</td>
                      <td className="py-1.5 text-right text-teal-600 font-medium">{a.incoming_booked}</td>
                      <td className="py-1.5 text-right border-l border-slate-100">{a.outgoing}</td>
                      <td className="py-1.5 text-right">{a.outgoing_reached}</td>
                      <td className="py-1.5 text-right text-teal-600 font-medium">{a.outgoing_booked}</td>
                      <td className="py-1.5 text-right border-l border-slate-100">{a.confirmation}</td>
                      <td className="py-1.5 text-right text-teal-600 font-medium">{a.confirmation_confirmed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Call Log" subtitle="Every incoming, outgoing, and confirmation call in this period, with patient details — click a column header to sort">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input
                type="text"
                placeholder="Search patient, phone, or agent…"
                className="input py-1.5 text-xs w-56"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <div className="flex items-center gap-1 flex-wrap">
                {(['all', 'Incoming', 'Outgoing', 'Confirmation - Night Before', 'Confirmation - Morning Of'] as const).map(d => (
                  <button
                    key={d}
                    onClick={() => setDirectionFilter(d)}
                    className={`text-xs px-2.5 py-1 rounded-md transition-colors ${directionFilter === d ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    {d === 'all' ? 'All' : d}
                  </button>
                ))}
              </div>
              <span className="text-xs text-slate-400 ml-auto">{callLog.length} call{callLog.length === 1 ? '' : 's'}</span>
            </div>
            {callLog.length === 0 ? (
              <p className="text-sm text-slate-400">No calls match this filter.</p>
            ) : (
              <div className="overflow-auto max-h-[500px]">
                <table className="w-full text-sm border-collapse">
                  <thead className="text-xs text-slate-400 uppercase sticky top-0 bg-white">
                    <tr>
                      <th className="w-5 border border-slate-200 px-2"></th>
                      <SortHeader label="Date" k="call_date" />
                      <SortHeader label="Direction" k="direction" />
                      <SortHeader label="Source" k="source" />
                      <th className="text-left py-1 border border-slate-200 px-2">Lead Bucket</th>
                      <SortHeader label="Patient" k="patient_name" />
                      <th className="text-left py-1 border border-slate-200 px-2">Old/New</th>
                      <th className="text-left py-1 border border-slate-200 px-2">Phone</th>
                      <th className="text-left py-1 border border-slate-200 px-2">Hospital ID</th>
                      <th className="text-left py-1 border border-slate-200 px-2">Location</th>
                      <SortHeader label="Agent" k="agent" />
                      <SortHeader label="Outcome" k="outcome" />
                      <th className="text-left py-1 border border-slate-200 px-2">Doctor / Service</th>
                      <th className="text-left py-1 border border-slate-200 px-2">Appointment</th>
                      <th className="text-left py-1 border border-slate-200 px-2">Invoice Match</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {callLog.map((r, i) => {
                      const isOpen = expandedRow === i
                      const invoiceMatch = invoiceMatches[i]
                      const detailEntries = Object.entries(r.details || {}).filter(([, v]) => v !== null && v !== '')
                      return (
                        <Fragment key={i}>
                          <tr
                            className="cursor-pointer hover:bg-slate-50 align-top"
                            onClick={() => expandCallRow(i, r)}
                          >
                            <td className="py-1.5 text-slate-400 text-center border border-slate-100 px-2">{isOpen ? '▾' : '▸'}</td>
                            <td className="py-1.5 whitespace-nowrap text-slate-500 border border-slate-100 px-2">
                              {new Date(r.call_date).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="py-1.5 border border-slate-100 px-2">
                              <span className={`inline-block text-xs rounded-md px-2 py-0.5 leading-tight w-full text-center break-words ${DIRECTION_BADGE[r.direction] || 'bg-slate-100 text-slate-600'}`}>
                                {r.direction}
                              </span>
                            </td>
                            <td className="py-1.5 border border-slate-100 px-2">
                              <span className={`inline-block text-xs rounded-md px-2 py-0.5 leading-tight w-full text-center break-words ${SOURCE_BADGE[r.source || ''] || 'bg-slate-100 text-slate-500'}`}>
                                {r.source || '—'}
                              </span>
                            </td>
                            <td className="py-1.5 border border-slate-100 px-2">
                              <span className="inline-block text-xs rounded-md px-2 py-0.5 leading-tight break-words bg-sky-50 text-sky-700 max-w-[130px]">
                                {r.details?.lead_bucket || '—'}
                              </span>
                            </td>
                            <td className="py-1.5 break-words max-w-[140px] border border-slate-100 px-2">{r.patient_name || '—'}</td>
                            <td className="py-1.5 border border-slate-100 px-2">
                              <span className={`text-xs rounded-full px-2 py-0.5 whitespace-nowrap ${PATIENT_TYPE_BADGE[r.patient_type || 'Unknown']}`}>
                                {r.patient_type || 'Unknown'}
                              </span>
                            </td>
                            <td className="py-1.5 text-slate-600 whitespace-nowrap border border-slate-100 px-2">{r.phone || '—'}</td>
                            <td className="py-1.5 text-slate-600 whitespace-nowrap font-mono text-xs border border-slate-100 px-2">{r.hospital_id || '—'}</td>
                            <td className="py-1.5 text-slate-600 break-words max-w-[110px] border border-slate-100 px-2">{r.location || '—'}</td>
                            <td className="py-1.5 break-words max-w-[100px] border border-slate-100 px-2">{r.agent || '—'}</td>
                            <td className="py-1.5 border border-slate-100 px-2">
                              {r.outcome ? (
                                <span className={`inline-block text-xs rounded-full px-2 py-0.5 break-words max-w-[130px] ${OUTCOME_BADGE[r.outcome] || 'bg-slate-100 text-slate-600'}`}>
                                  {r.outcome}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="py-1.5 text-slate-600 max-w-[150px] break-words border border-slate-100 px-2">{r.doctor_service || '—'}</td>
                            <td className="py-1.5 text-slate-600 whitespace-nowrap border border-slate-100 px-2">
                              {r.appointment_date
                                ? `${new Date(r.appointment_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}${r.appointment_time ? ` · ${r.appointment_time}` : ''}`
                                : '—'}
                            </td>
                            <td className="py-1.5 border border-slate-100 px-2">
                              {invoiceLoading === i ? <span className="text-xs text-slate-400">Checking...</span> : invoiceMatch === undefined ? <span className="text-xs text-slate-400">Expand to check</span> : !invoiceMatch ? (
                                <span className="text-slate-300">—</span>
                              ) : invoiceMatch.status === 'matched' ? (
                                <span
                                  className="inline-block text-xs rounded-full px-2 py-0.5 break-words max-w-[140px] bg-emerald-100 text-emerald-700"
                                  title={`Invoice ${invoiceMatch.invoice_no} dated ${invoiceMatch.invoice_date}`}
                                >
                                  ✓ Matched · {invoiceMatch.method}
                                </span>
                              ) : (
                                <span className="inline-block text-xs rounded-full px-2 py-0.5 bg-rose-100 text-rose-700" title="No invoice found under this patient's ID, phone, or hospital ID within the visit window.">
                                  ✕ Missing
                                </span>
                              )}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-slate-50">
                              <td colSpan={15} className="px-4 py-3 space-y-3">
                                {detailEntries.length === 0 && !r.notes ? (
                                  <p className="text-xs text-slate-400">No additional details recorded.</p>
                                ) : (
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2">
                                    {detailEntries.map(([k, v]) => (
                                      <div key={k}>
                                        <div className="text-[10px] uppercase text-slate-400">{DETAIL_FIELD_LABEL[k] || k}</div>
                                        <div className="text-xs text-slate-700">{String(v)}</div>
                                      </div>
                                    ))}
                                    {r.notes && (
                                      <div className="col-span-2 md:col-span-4">
                                        <div className="text-[10px] uppercase text-slate-400">Notes</div>
                                        <div className="text-xs text-slate-700">{r.notes}</div>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {r.direction === 'Outgoing' && r.attempt_id != null && (
                                  <div className="border-t border-slate-200 pt-3">
                                    {correctingRow !== i ? (
                                      <button
                                        onClick={e => { e.stopPropagation(); openCorrection(i, r.outcome_code, r.notes) }}
                                        className="text-xs px-3 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100"
                                      >
                                        Correct outcome (patient called back)
                                      </button>
                                    ) : (
                                      <div className="space-y-2" onClick={e => e.stopPropagation()}>
                                        <p className="text-xs font-medium text-slate-600">Correct the recorded outcome</p>
                                        <div className="flex flex-wrap gap-2 items-end">
                                          <div>
                                            <label className="text-[10px] uppercase text-slate-400 block mb-1">New outcome</label>
                                            <select
                                              className="border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white"
                                              value={correctCode}
                                              onChange={e => setCorrectCode(e.target.value)}
                                            >
                                              <option value="">— select —</option>
                                              {OUTCOMES.map(o => (
                                                <option key={o.code} value={o.code}>{o.label}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div>
                                            <label className="text-[10px] uppercase text-slate-400 block mb-1">Notes (optional)</label>
                                            <input
                                              className="border border-slate-300 rounded-md px-2 py-1.5 text-xs w-56"
                                              placeholder="Add or update notes…"
                                              value={correctNotes}
                                              onChange={e => setCorrectNotes(e.target.value)}
                                            />
                                          </div>
                                          <button
                                            onClick={() => saveCorrection(r.attempt_id!)}
                                            disabled={correctState === 'saving' || correctState === 'success'}
                                            className="text-xs px-3 py-1.5 rounded-md bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                                          >
                                            {correctState === 'saving' ? 'Saving…' : correctState === 'success' ? 'Saved ✓' : 'Save correction'}
                                          </button>
                                          <button
                                            onClick={() => setCorrectingRow(null)}
                                            className="text-xs px-3 py-1.5 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                        {correctError && <p className="text-xs text-rose-600">{correctError}</p>}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}

'use client'
export const dynamic = 'force-dynamic'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { KPICard, BarList, Panel } from '@/components/admin/DashboardCharts'
import CallTrendChart from '@/components/callkpis/CallTrendChart'
import MiniCalendar from '@/components/callkpis/MiniCalendar'

type RangeKey = 'today' | '7d' | '30d' | 'month' | 'custom'

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

type CallLogRow = {
  call_date: string
  direction: string
  patient_name: string | null
  phone: string | null
  agent: string | null
  outcome: string | null
  notes: string | null
  details: Record<string, string | number | null> | null
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

type SortKey = 'call_date' | 'patient_name' | 'direction' | 'agent' | 'outcome'

export default function CallKpisPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('today')
  const [customStart, setCustomStart] = useState(toISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [customEnd, setCustomEnd] = useState(toISO(new Date()))
  const { start, end } = useMemo(() => rangeFor(rangeKey, customStart, customEnd), [rangeKey, customStart, customEnd])

  const [metrics, setMetrics] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [sortKey, setSortKey] = useState<SortKey>('call_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [directionFilter, setDirectionFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const [calendarMonth, setCalendarMonth] = useState(() => new Date())
  const selectedDate = rangeKey === 'custom' && customStart === customEnd ? customStart : null

  function selectDate(iso: string) {
    setRangeKey('custom')
    setCustomStart(iso)
    setCustomEnd(iso)
    setCalendarMonth(new Date(iso + 'T00:00:00'))
  }

  const countsByDate = useMemo(() => {
    const map: Record<string, number> = {}
    for (const d of metrics?.daily_trend || []) {
      map[d.date] = (d.incoming || 0) + (d.outgoing || 0) + (d.confirmation || 0)
    }
    return map
  }, [metrics])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    supabase.rpc('get_call_center_kpis', { p_start_date: start, p_end_date: end }).then(({ data, error }) => {
      if (cancelled) return
      if (error) { setError(error.message); setLoading(false); return }
      setMetrics(data)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [start, end])

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
      <th className="text-left py-1 cursor-pointer select-none hover:text-slate-600" onClick={() => toggleSort(k)}>
        {label}{sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
      </th>
    )
  }

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Call Center KPIs</h1>
          <p className="text-sm text-slate-500">Incoming (lead intake) and outgoing (follow-up) call volume and outcomes, per agent</p>
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

          <div className="flex flex-col lg:flex-row gap-4 items-start">
            <MiniCalendar
              month={calendarMonth}
              onMonthChange={setCalendarMonth}
              selectedDate={selectedDate}
              onSelectDate={selectDate}
              countsByDate={countsByDate}
            />
            <div className="flex-1 w-full min-w-0">
              <Panel title="Call Log" subtitle={selectedDate ? `Calls on ${new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} — click a column header to sort` : 'Every incoming, outgoing, and confirmation call in this period, with patient details — click a column header to sort'}>
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
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-400 uppercase sticky top-0 bg-white">
                    <tr>
                      <th className="w-5"></th>
                      <SortHeader label="Date" k="call_date" />
                      <SortHeader label="Direction" k="direction" />
                      <SortHeader label="Patient" k="patient_name" />
                      <th className="text-left py-1">Phone</th>
                      <SortHeader label="Agent" k="agent" />
                      <SortHeader label="Outcome" k="outcome" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {callLog.map((r, i) => {
                      const isOpen = expandedRow === i
                      const detailEntries = Object.entries(r.details || {}).filter(([, v]) => v !== null && v !== '')
                      return (
                        <Fragment key={i}>
                          <tr
                            className="cursor-pointer hover:bg-slate-50"
                            onClick={() => setExpandedRow(isOpen ? null : i)}
                          >
                            <td className="py-1.5 text-slate-400 text-center">{isOpen ? '▾' : '▸'}</td>
                            <td className="py-1.5 whitespace-nowrap text-slate-500">
                              {new Date(r.call_date).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="py-1.5">
                              <span className={`text-xs rounded-full px-2 py-0.5 whitespace-nowrap ${DIRECTION_BADGE[r.direction] || 'bg-slate-100 text-slate-600'}`}>
                                {r.direction}
                              </span>
                            </td>
                            <td className="py-1.5">{r.patient_name || '—'}</td>
                            <td className="py-1.5 text-slate-600 whitespace-nowrap">{r.phone || '—'}</td>
                            <td className="py-1.5">{r.agent || '—'}</td>
                            <td className="py-1.5">{r.outcome || '—'}</td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-slate-50">
                              <td colSpan={7} className="px-4 py-3">
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
          </div>
        </div>
      )}
    </div>
  )
}

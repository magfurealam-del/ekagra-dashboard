'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { KPICard, BarList, Panel } from '@/components/admin/DashboardCharts'
import CallTrendChart from '@/components/callkpis/CallTrendChart'

type RangeKey = 'today' | '7d' | '30d' | 'month' | 'custom'

function toISO(d: Date) { return d.toISOString().slice(0, 10) }

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

export default function CallKpisPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('today')
  const [customStart, setCustomStart] = useState(toISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [customEnd, setCustomEnd] = useState(toISO(new Date()))
  const { start, end } = useMemo(() => rangeFor(rangeKey, customStart, customEnd), [rangeKey, customStart, customEnd])

  const [metrics, setMetrics] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <KPICard label="Incoming Calls" value={metrics.incoming_total} tone="text-teal-600"
              tooltip="Calls received and logged via Lead Intake during this period." />
            <KPICard label="Outgoing Calls Made" value={metrics.outgoing_total} tone="text-indigo-600"
              tooltip="Outbound follow-up calls actually attempted (outcome recorded) in this period, from the Outgoing Call Sheet." />
            <KPICard label="Outgoing Pending" value={metrics.outgoing_pending} tone="text-amber-600"
              tooltip="Snapshot right now (not date-range filtered): open items still waiting in the outgoing call queue." />
          </div>

          <Panel title="Daily Call Volume" subtitle="Incoming vs. outgoing calls, per day">
            <CallTrendChart data={metrics.daily_trend || []} />
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
          </div>

          <Panel title="Agent Performance" subtitle="Incoming and outgoing call volume, and booking outcomes, per agent">
            {(metrics.by_agent || []).length === 0 ? (
              <p className="text-sm text-slate-400">No agent-attributed calls this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-400 uppercase">
                  <tr>
                    <th className="text-left py-1">Agent</th>
                    <th className="text-right py-1">Incoming</th>
                    <th className="text-right py-1">Incoming Booked</th>
                    <th className="text-right py-1">Outgoing</th>
                    <th className="text-right py-1">Outgoing Reached</th>
                    <th className="text-right py-1">Outgoing Booked</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(metrics.by_agent || []).map((a: any) => (
                    <tr key={a.agent}>
                      <td className="py-1.5">{a.agent}</td>
                      <td className="py-1.5 text-right">{a.incoming}</td>
                      <td className="py-1.5 text-right text-teal-600 font-medium">{a.incoming_booked}</td>
                      <td className="py-1.5 text-right">{a.outgoing}</td>
                      <td className="py-1.5 text-right">{a.outgoing_reached}</td>
                      <td className="py-1.5 text-right text-teal-600 font-medium">{a.outgoing_booked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}

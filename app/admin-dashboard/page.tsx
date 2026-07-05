'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { appointmentTypeColor } from '@/lib/appointmentTypeColors'
import { KPICard, BarList, TrendChart, Panel, FunnelChart } from '@/components/admin/DashboardCharts'

type RangeKey = 'today' | '7d' | '30d' | 'month' | 'custom'
type Tab = 'overview' | 'funnel' | 'revenue' | 'sources' | 'quality'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'funnel', label: 'Funnel & Follow-ups' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'sources', label: 'Sources & Patients' },
  { key: 'quality', label: 'Data Quality' },
]

function toISO(d: Date) { return d.toISOString().slice(0, 10) }
function daysBetween(a: string, b: string) { return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1 }

function rangeFor(key: RangeKey, customStart: string, customEnd: string) {
  const today = new Date()
  if (key === 'today') return { start: toISO(today), end: toISO(today) }
  if (key === '7d') { const s = new Date(today); s.setDate(s.getDate() - 6); return { start: toISO(s), end: toISO(today) } }
  if (key === '30d') { const s = new Date(today); s.setDate(s.getDate() - 29); return { start: toISO(s), end: toISO(today) } }
  if (key === 'month') { const s = new Date(today.getFullYear(), today.getMonth(), 1); return { start: toISO(s), end: toISO(today) } }
  return { start: customStart, end: customEnd }
}

function previousRangeFor(start: string, end: string) {
  const len = daysBetween(start, end)
  const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1)
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - (len - 1))
  return { start: toISO(prevStart), end: toISO(prevEnd) }
}

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null
  return Math.round(((curr - prev) / prev) * 1000) / 10
}

const SOURCE_COLORS: Record<string, string> = {
  'Facebook': 'bg-blue-500',
  'Referral': 'bg-emerald-500',
  'Phone / Hotline': 'bg-amber-500',
  'Walk-in': 'bg-purple-500',
  'Unknown': 'bg-slate-400',
}

const OUTCOME_COLORS: Record<string, string> = {
  'Appointment Booked': 'bg-teal-500',
  'No Appointment Yet': 'bg-amber-500',
  'No-show': 'bg-rose-500',
  'Not Interested': 'bg-slate-400',
  'General Inquiry': 'bg-sky-500',
  'Call Back Later': 'bg-indigo-500',
  'Suppressed': 'bg-slate-300',
}

function money(n: number) {
  return `৳${Math.round(n).toLocaleString()}`
}

export default function AdminDashboardPage() {
  const router = useRouter()
  const { profile, isAdmin, loading: authLoading } = useAuth()

  useEffect(() => {
    if (!authLoading && profile && !isAdmin) router.replace('/')
  }, [authLoading, profile, isAdmin, router])

  const [tab, setTab] = useState<Tab>('overview')
  const [rangeKey, setRangeKey] = useState<RangeKey>('month')
  const [customStart, setCustomStart] = useState(toISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [customEnd, setCustomEnd] = useState(toISO(new Date()))
  const [compare, setCompare] = useState(false)
  const { start, end } = useMemo(() => rangeFor(rangeKey, customStart, customEnd), [rangeKey, customStart, customEnd])
  const prevRange = useMemo(() => previousRangeFor(start, end), [start, end])

  const [metrics, setMetrics] = useState<any | null>(null)
  const [prevMetrics, setPrevMetrics] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      supabase.rpc('get_admin_dashboard_metrics', { p_start_date: start, p_end_date: end }),
      compare ? supabase.rpc('get_admin_dashboard_metrics', { p_start_date: prevRange.start, p_end_date: prevRange.end }) : Promise.resolve({ data: null, error: null }),
    ]).then(([curr, prev]) => {
      if (cancelled) return
      if (curr.error) { setError(curr.error.message); setLoading(false); return }
      setMetrics(curr.data)
      setPrevMetrics(prev.data)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [start, end, compare, prevRange.start, prevRange.end, isAdmin])

  if (!isAdmin) return null

  const bookingRate = metrics && metrics.total_leads > 0 ? Math.round((metrics.booked_leads / metrics.total_leads) * 100) : 0
  const prevBookingRate = prevMetrics && prevMetrics.total_leads > 0 ? Math.round((prevMetrics.booked_leads / prevMetrics.total_leads) * 100) : 0
  const d = (curr: number, key: string) => compare && prevMetrics ? pctDelta(curr, prevMetrics[key]) : undefined

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
          <p className="text-sm text-slate-500">Call center performance, patient mix, revenue, and follow-up funnel</p>
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
          <label className="flex items-center gap-1.5 text-xs text-slate-600 pl-2 border-l border-slate-200 ml-1">
            <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} />
            Compare to previous period
          </label>
        </div>
      </div>

      {compare && (
        <p className="text-xs text-slate-400">
          Comparing to {prevRange.start} → {prevRange.end} (same length, immediately prior)
        </p>
      )}

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-md p-3">{error}</div>}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 -mb-px">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-sm px-3 py-2 border-b-2 transition-colors ${tab === t.key ? 'border-teal-600 text-teal-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading || !metrics ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <>
          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                <KPICard label="Total Leads" value={metrics.total_leads} tone="text-slate-800" delta={d(metrics.total_leads, 'total_leads')}
                  tooltip="Every call/contact logged in Lead Intake during this period, regardless of outcome." />
                <KPICard label="Booked" value={metrics.booked_leads} tone="text-teal-600" delta={d(metrics.booked_leads, 'booked_leads')}
                  tooltip="Leads from this period whose intake outcome was 'Appointment Booked'." />
                <KPICard label="Booking Rate" value={`${bookingRate}%`} tone="text-teal-600" delta={compare && prevMetrics ? pctDelta(bookingRate, prevBookingRate) : undefined}
                  tooltip="Booked ÷ Total Leads. How often a call turns into a scheduled visit." />
                <KPICard label="Appointments" value={metrics.total_appointments} tone="text-indigo-600" delta={d(metrics.total_appointments, 'total_appointments')}
                  tooltip="All appointments with a visit date inside this period, booked at any time." />
                <KPICard label="Attended" value={metrics.attended} tone="text-emerald-600" delta={d(metrics.attended, 'attended')}
                  tooltip="Invoice-validated: only counted if a matching invoice exists for that patient nearby — not just the agent-set status." />
                <KPICard label="Show Rate" value={metrics.show_rate != null ? `${metrics.show_rate}%` : '—'} tone="text-emerald-600" delta={compare && prevMetrics ? pctDelta(metrics.show_rate || 0, prevMetrics.show_rate || 0) : undefined}
                  tooltip="Attended ÷ (Attended + No-Shows) among appointments already in the past. Excludes upcoming/Scheduled visits." />
                <KPICard label="No-Shows" value={metrics.no_shows} tone="text-rose-600" delta={d(metrics.no_shows, 'no_shows')}
                  tooltip="Past-dated, non-cancelled appointments with no matching invoice found — see Data Quality tab for the full reconciliation." />
                <KPICard label="Pending Callbacks" value={metrics.pending_callbacks} tone="text-amber-600"
                  tooltip="Snapshot right now (not date-range filtered): open items in the Outgoing Calls queue." />
              </div>

              <Panel title="Daily Trend" subtitle="Leads received vs appointments scheduled, per day">
                <TrendChart data={metrics.daily_trend || []} />
              </Panel>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Panel title="Intake Call Outcomes" subtitle="What happened on the intake call itself">
                  <BarList
                    items={(metrics.by_intake_outcome || []).map((s: any) => ({ label: s.outcome, count: s.count }))}
                    colorFor={(label) => OUTCOME_COLORS[label] || 'bg-slate-400'}
                  />
                </Panel>
                <Panel title="New vs Returning Patients">
                  <BarList
                    items={(metrics.by_patient_type || []).map((s: any) => ({ label: s.type, count: s.count }))}
                    colorFor={(label) => label === 'New' ? 'bg-teal-500' : label === 'Old' ? 'bg-indigo-500' : 'bg-slate-400'}
                  />
                </Panel>
              </div>
            </div>
          )}

          {tab === 'funnel' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel title="Lead → Appointment Funnel" subtitle="From first contact to a completed visit">
                <FunnelChart steps={[
                  { label: 'Leads', count: metrics.total_leads, hint: 'every logged call this period' },
                  { label: 'Booked', count: metrics.booked_leads, hint: 'intake outcome was Appointment Booked' },
                  { label: 'Attended', count: metrics.attended, hint: 'invoice-validated visit, not just agent-set status' },
                ]} />
              </Panel>
              <Panel title="Follow-up Funnel" subtitle="Outbound follow-up calls in this period">
                <FunnelChart steps={[
                  { label: 'Logged', count: metrics.follow_up_funnel?.logged || 0, hint: 'follow-up calls recorded this period' },
                  { label: 'Reached', count: metrics.follow_up_funnel?.reached || 0, hint: 'excludes no-response/not-reachable/switched-off' },
                  { label: 'Positive Outcome', count: metrics.follow_up_funnel?.positive || 0, hint: 'mentions a booking or resolved problem in the notes' },
                ]} />
                <p className="text-xs text-slate-400 mt-2">
                  &quot;Positive&quot; = mentions an appointment/booking or a resolved problem in the call notes — a
                  rough signal from free-text notes, not a strict status field.
                </p>
              </Panel>
              <Panel title="Pending Callback Queue" subtitle="Point-in-time snapshot, not filtered by date range">
                <KPICard label="Open in Queue" value={metrics.pending_callbacks} tone="text-amber-600"
                  tooltip="Outgoing Calls queue items still awaiting a call attempt, right now." />
              </Panel>
            </div>
          )}

          {tab === 'revenue' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KPICard label="Total Revenue" value={money(metrics.total_revenue)} tone="text-emerald-600" delta={d(metrics.total_revenue, 'total_revenue')}
                  tooltip="Sum of invoice revenue attributed back to a lead's source, for invoices dated in this period." />
                <KPICard
                  label="Revenue / Booked Lead"
                  value={metrics.booked_leads > 0 ? money(metrics.total_revenue / metrics.booked_leads) : '—'}
                  tone="text-emerald-600"
                  tooltip="Total Revenue ÷ Booked leads. A rough per-booking value, not a true per-patient average."
                />
              </div>
              <Panel title="Revenue by Source" subtitle="Attributed via matched invoices (crm_billing_links), not every lead has a matched invoice yet">
                <BarList
                  items={(metrics.revenue_by_source || []).map((s: any) => ({ label: s.source, count: Math.round(s.revenue) }))}
                  colorFor={(label) => SOURCE_COLORS[label] || 'bg-slate-400'}
                  unit="৳"
                />
              </Panel>
            </div>
          )}

          {tab === 'sources' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel title="Lead Source" subtitle="Facebook vs referral vs phone vs unknown">
                <BarList
                  items={(metrics.by_source || []).map((s: any) => ({ label: s.source, count: s.count }))}
                  colorFor={(label) => SOURCE_COLORS[label] || 'bg-slate-400'}
                />
              </Panel>
              <Panel title="Patient Location" subtitle="Top areas among leads this period">
                <BarList items={(metrics.by_location || []).map((s: any) => ({ label: s.area, count: s.count }))} />
              </Panel>
              <Panel title="Service Type" subtitle="Appointments by service type (from Lead Intake)">
                <BarList
                  items={(metrics.by_service_type || []).map((s: any) => ({ label: s.type, count: s.count }))}
                  colorFor={(label) => appointmentTypeColor(label).dot}
                />
              </Panel>
              <Panel title="Doctor Performance" subtitle="Appointments, invoice-validated no-show rate, and revenue per doctor">
                {(metrics.by_doctor_performance || []).length === 0 ? (
                  <p className="text-sm text-slate-400">No appointments this period.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-slate-400 uppercase">
                      <tr>
                        <th className="text-left py-1">Doctor</th>
                        <th className="text-right py-1">Appts</th>
                        <th className="text-right py-1">No-Show Rate</th>
                        <th className="text-right py-1">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(metrics.by_doctor_performance || []).map((d: any) => (
                        <tr key={d.doctor}>
                          <td className="py-1.5 truncate max-w-[160px]">{d.doctor}</td>
                          <td className="py-1.5 text-right">{d.appointments}</td>
                          <td className={`py-1.5 text-right font-medium ${d.no_show_rate > 40 ? 'text-rose-600' : d.no_show_rate > 20 ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {d.no_show_rate != null ? `${d.no_show_rate}%` : '—'}
                          </td>
                          <td className="py-1.5 text-right text-slate-700">{money(d.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="text-xs text-slate-400 mt-2">
                  No-show rate is invoice-validated: an appointment counts as attended only if a matching invoice
                  exists for that patient nearby, across all invoice types (daycare, pathology, pharmacy, IPD) —
                  not admissions-only.
                </p>
              </Panel>
              <Panel title="Agent Performance" subtitle="Leads handled and booking rate per agent">
                {(metrics.by_agent || []).length === 0 ? (
                  <p className="text-sm text-slate-400">No agent-attributed leads this period.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-slate-400 uppercase">
                      <tr>
                        <th className="text-left py-1">Agent</th>
                        <th className="text-right py-1">Leads</th>
                        <th className="text-right py-1">Booked</th>
                        <th className="text-right py-1">Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(metrics.by_agent || []).map((a: any) => (
                        <tr key={a.agent}>
                          <td className="py-1.5">{a.agent}</td>
                          <td className="py-1.5 text-right">{a.leads}</td>
                          <td className="py-1.5 text-right">{a.booked}</td>
                          <td className="py-1.5 text-right font-medium text-teal-600">{a.booking_rate != null ? `${a.booking_rate}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Panel>
            </div>
          )}

          {tab === 'quality' && (
            <div className="space-y-4">
              <Panel
                title="No-Show / Attendance Validation"
                subtitle="Cross-checks the CRM's reported appointment status against the invoice source of truth (OCR/Google-Sheet fed, all invoice types — daycare, pathology, pharmacy, IPD)"
              >
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  <KPICard label="CRM: Completed" value={metrics.attendance_validation?.crm_completed ?? 0} tone="text-emerald-600" />
                  <KPICard
                    label="…with a matching invoice"
                    value={metrics.attendance_validation?.crm_completed_with_invoice ?? 0}
                    tone="text-emerald-600"
                    sub={metrics.attendance_validation?.crm_completed > 0
                      ? `${Math.round(100 * (metrics.attendance_validation.crm_completed_with_invoice / metrics.attendance_validation.crm_completed))}% of Completed`
                      : undefined}
                  />
                  <KPICard label="CRM: No-show" value={metrics.attendance_validation?.crm_no_show ?? 0} tone="text-rose-600" />
                  <KPICard
                    label="…but has an invoice anyway"
                    value={metrics.attendance_validation?.crm_no_show_with_invoice ?? 0}
                    tone="text-amber-600"
                    sub="worth a second look"
                  />
                </div>
                <div className="bg-sky-50 border border-sky-200 rounded-md p-3 text-xs text-sky-800">
                  The Overview tab&apos;s <strong>Attended</strong>/<strong>No-Shows</strong>/<strong>Show Rate</strong> now
                  use this invoice-validated definition directly (not the agent-set status alone) — an appointment
                  only counts as attended if a matching invoice exists for that patient within a few days, across
                  every invoice type. The table here is the transparency layer: it shows where the CRM&apos;s status
                  and the invoice record disagree, so &quot;No-show but has an invoice anyway&quot; is the case worth
                  double-checking first.
                </div>
              </Panel>
            </div>
          )}
        </>
      )}
    </div>
  )
}

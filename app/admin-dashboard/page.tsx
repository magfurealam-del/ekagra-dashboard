'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { appointmentTypeColor } from '@/lib/appointmentTypeColors'
import { KPICard, BarList, TrendChart, Panel, FunnelChart, DonutChart, GaugeMeter, AgentTable, DoctorTable } from '@/components/admin/DashboardCharts'

type RangeKey = 'today' | '7d' | '30d' | 'month' | 'custom'
type Tab = 'overview' | 'agents' | 'channels' | 'funnel' | 'revenue' | 'sources' | 'quality' | 'ad_attribution'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'agents', label: 'Agents' },
  { key: 'channels', label: 'Sources & Channels' },
  { key: 'funnel', label: 'Funnel & Follow-ups' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'sources', label: 'Marketing Attribution' },
  { key: 'quality', label: 'Data Quality' },
  { key: 'ad_attribution', label: 'Ad Attribution' },
]

// Fixed categorical color per channel, used consistently across every chart
// on the Agents tab so "outbound" is always the same color everywhere.
const CHANNEL_COLORS = { incoming: '#0d9488', outgoing: '#6366f1', outbound: '#f59e0b', confirmation: '#0ea5e9' }
// Same four colors as Tailwind classes, for components (like BarList) that take a class instead of a hex value.
const CHANNEL_COLOR_CLASS = { incoming: 'bg-teal-500', outgoing: 'bg-indigo-500', outbound: 'bg-amber-500', confirmation: 'bg-sky-500' }

interface AgentDetailRow {
  agent: string
  incoming: number; incoming_booked: number
  outgoing_leads: number; outgoing_leads_booked: number
  outbound: number; outbound_reached: number; outbound_booked: number
  outbound_outcomes: { outcome: string; count: number }[]
  outbound_appointments_set: number; outbound_appointments_eligible: number; outbound_appointments_attended: number
  confirmation: number; confirmation_confirmed: number
  appointments_set: number; no_shows: number; no_show_rate: number | null
  revenue_new: number; revenue_followup: number; attempts_per_booking: number | null
  trend: { date: string; leads: number; booked: number }[]
  booked_to_completed: number; booked_to_no_show: number
  status_change_daily: { date: string; booked_to_completed: number; booked_to_no_show: number }[]
  bookableCalls: number; appointmentsSet: number; totalCalls: number
  conversionRate: number | null; confirmRate: number | null; reachedRate: number | null; outboundAttendedRate: number | null
}

// Same vocabulary as the Call KPIs page's outbound outcome labels, so the
// two views describe outcomes identically.
const OUTBOUND_OUTCOME_LABEL: Record<string, string> = {
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

// Fixed per-outcome color (not per-rank) so "Reached" is always the same
// color on every agent's card, regardless of where it falls in that
// agent's own sorted-by-count order. Same palette as the Call KPIs page's
// outbound outcome colors.
const OUTBOUND_OUTCOME_COLORS: Record<string, string> = {
  'Reached': 'bg-emerald-500',
  'Booked Appointment': 'bg-teal-500',
  'Not Reached': 'bg-slate-400',
  'Busy': 'bg-amber-500',
  'Switched Off': 'bg-indigo-300',
  'Wrong Number': 'bg-rose-500',
  'Already Visited': 'bg-indigo-500',
  'Not Interested': 'bg-fuchsia-400',
  'Call Later': 'bg-sky-500',
  'Do Not Call': 'bg-rose-700',
  'Unspecified': 'bg-slate-300',
}

interface SourcePerfRow {
  source: string
  leads: number; new_leads: number; old_leads: number
  appointments_set: number; new_appointments_set: number; old_appointments_set: number
  appointments_eligible: number; no_shows: number
  new_attended: number; old_attended: number
  revenue_new: number; revenue_followup: number
  attendedRate: number | null; newShare: number | null
}

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

const adminCache: { key: string; data: any; prevData: any; fetchedAt: number } = { key: '', data: null, prevData: null, fetchedAt: 0 }
const ADMIN_TTL_MS = 30 * 60 * 1000
function snapshotKey(start: string, end: string) { return `${start}:${end}` }

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
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  const [adRows, setAdRows] = useState<any[] | null>(null)
  const [adLoading, setAdLoading] = useState(false)
  const [adError, setAdError] = useState('')

  useEffect(() => {
    if (!isAdmin || tab !== 'ad_attribution') return
    let cancelled = false
    setAdLoading(true)
    setAdError('')
    supabase.rpc('get_ad_attribution_report', { p_start_date: start, p_end_date: end }).then(({ data, error }) => {
      if (cancelled) return
      if (error) { setAdError(error.message); setAdLoading(false); return }
      setAdRows(Array.isArray(data) ? data : [])
      setAdLoading(false)
    })
    return () => { cancelled = true }
  }, [tab, start, end, isAdmin])

  const [agentPerf, setAgentPerf] = useState<any | null>(null)
  const [agentPerfLoading, setAgentPerfLoading] = useState(false)
  const [agentPerfError, setAgentPerfError] = useState('')

  useEffect(() => {
    if (!isAdmin || tab !== 'agents') return
    let cancelled = false
    setAgentPerfLoading(true)
    setAgentPerfError('')
    supabase.rpc('get_admin_agent_performance', { p_start_date: start, p_end_date: end }).then(({ data, error }) => {
      if (cancelled) return
      if (error) { setAgentPerfError(error.message); setAgentPerfLoading(false); return }
      setAgentPerf(data)
      setAgentPerfLoading(false)
    })
    return () => { cancelled = true }
  }, [tab, start, end, isAdmin])

  const [sourcePerf, setSourcePerf] = useState<any | null>(null)
  const [sourcePerfLoading, setSourcePerfLoading] = useState(false)
  const [sourcePerfError, setSourcePerfError] = useState('')

  useEffect(() => {
    if (!isAdmin || tab !== 'channels') return
    let cancelled = false
    setSourcePerfLoading(true)
    setSourcePerfError('')
    supabase.rpc('get_admin_source_performance', { p_start_date: start, p_end_date: end }).then(({ data, error }) => {
      if (cancelled) return
      if (error) { setSourcePerfError(error.message); setSourcePerfLoading(false); return }
      setSourcePerf(data)
      setSourcePerfLoading(false)
    })
    return () => { cancelled = true }
  }, [tab, start, end, isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    const cacheKey = `${start}|${end}|${compare}|${prevRange.start}|${prevRange.end}`
    if (adminCache.key === cacheKey && Date.now() - adminCache.fetchedAt < ADMIN_TTL_MS) {
      setMetrics(adminCache.data)
      setPrevMetrics(adminCache.prevData)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    Promise.all([
      supabase.from('dashboard_metric_snapshots').select('metrics, refreshed_at').eq('snapshot_key', snapshotKey(start, end)).maybeSingle(),
      compare ? supabase.from('dashboard_metric_snapshots').select('metrics').eq('snapshot_key', snapshotKey(prevRange.start, prevRange.end)).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]).then(([curr, prev]) => {
      if (cancelled) return
      if (curr.error) { setError(curr.error.message); setLoading(false); return }
      if (!curr.data) { setError('No scheduled snapshot is available for this range yet. Use Refresh on the home page or wait for the 6:00 AM Bangladesh refresh.'); setLoading(false); return }
      adminCache.key = cacheKey
      adminCache.data = curr.data.metrics
      adminCache.prevData = prev.data?.metrics ?? null
      adminCache.fetchedAt = Date.now()
      setMetrics(curr.data.metrics)
      setPrevMetrics(prev.data?.metrics ?? null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [start, end, compare, prevRange.start, prevRange.end, isAdmin])

  async function reloadMetrics() {
    const { data, error } = await supabase.rpc('refresh_dashboard_metric_snapshot', { p_start_date: start, p_end_date: end })
    if (error) { setSyncMsg(error.message); return }
    if (data?.metrics) {
      adminCache.key = ''  // invalidate so next mount re-fetches
      setMetrics(data.metrics)
    }
  }

  // Recomputes appointment_status from the invoice source of truth for
  // appointments on/after sinceDate — lets an admin re-trigger the June-
  // onwards correction (or any range) without needing direct DB access.
  async function recomputeStatusFromInvoices(sinceDate: string | null) {
    setSyncing(true)
    setSyncMsg('')
    const { data, error } = await supabase.rpc('sync_appointment_status_from_invoices', {
      p_only_pending: false,
      p_since_date: sinceDate,
    })
    setSyncing(false)
    if (error) { setSyncMsg('Error: ' + error.message); return }
    setSyncMsg(`Updated ${data} appointment${data === 1 ? '' : 's'}.`)
    reloadMetrics()
  }

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

              {/* Gauge row — headline rates at a glance */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <GaugeMeter
                  value={bookingRate}
                  label="Booking Rate"
                  sublabel="Booked ÷ Total Leads"
                  good={60} warn={30}
                />
                <GaugeMeter
                  value={metrics.show_rate ?? 0}
                  label="Show Rate"
                  sublabel="Invoice-validated"
                  good={70} warn={45}
                />
                <div className="col-span-2 hidden md:block" />
              </div>

              <Panel title="Daily Trend" subtitle="Leads received vs appointments scheduled, per day">
                <TrendChart data={metrics.daily_trend || []} />
              </Panel>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Panel title="Intake Call Outcomes" subtitle="What happened on the intake call itself">
                  <DonutChart
                    items={(metrics.by_intake_outcome || []).map((s: any) => ({ label: s.outcome, count: s.count }))}
                  />
                </Panel>
                <Panel title="New vs Returning Patients">
                  <DonutChart
                    items={(metrics.by_patient_type || []).map((s: any) => ({ label: s.type, count: s.count }))}
                  />
                </Panel>
              </div>
            </div>
          )}

          {tab === 'agents' && (() => {
            type AgentPerfRow = {
              agent: string
              incoming: number; incoming_booked: number
              outgoing_leads: number; outgoing_leads_booked: number
              outbound: number; outbound_reached: number; outbound_booked: number
              outbound_outcomes: { outcome: string; count: number }[]
              outbound_appointments_set: number; outbound_appointments_eligible: number; outbound_appointments_attended: number
              confirmation: number; confirmation_confirmed: number
              appointments_set: number; no_shows: number; no_show_rate: number | null
              revenue_new: number; revenue_followup: number; attempts_per_booking: number | null
              trend: { date: string; leads: number; booked: number }[]
              booked_to_completed: number; booked_to_no_show: number
              status_change_daily: { date: string; booked_to_completed: number; booked_to_no_show: number }[]
            }
            if (agentPerfLoading) {
              return (
                <div className="space-y-2">
                  {[0, 1, 2, 3].map(i => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}
                </div>
              )
            }
            if (agentPerfError) {
              return <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-md p-3">{agentPerfError}</div>
            }
            const rows = ((agentPerf?.agents || []) as AgentPerfRow[]).map(a => {
              const bookableCalls = a.incoming + a.outgoing_leads + a.outbound
              const totalCalls = bookableCalls + a.confirmation
              const appointmentsSet = a.incoming_booked + a.outgoing_leads_booked + a.outbound_booked
              const conversionRate = bookableCalls > 0 ? Math.round((appointmentsSet / bookableCalls) * 1000) / 10 : null
              const confirmRate = a.confirmation > 0 ? Math.round((a.confirmation_confirmed / a.confirmation) * 1000) / 10 : null
              const reachedRate = a.outbound > 0 ? Math.round((a.outbound_reached / a.outbound) * 1000) / 10 : null
              const outboundAttendedRate = a.outbound_appointments_eligible > 0
                ? Math.round((a.outbound_appointments_attended / a.outbound_appointments_eligible) * 1000) / 10
                : null
              return { ...a, bookableCalls, totalCalls, appointmentsSet, conversionRate, confirmRate, reachedRate, outboundAttendedRate }
            })
            const withVolume = rows.filter(a => a.bookableCalls >= 5)
            const topAgent = withVolume.length
              ? withVolume.reduce((best, a) => (a.conversionRate ?? 0) > (best.conversionRate ?? 0) ? a : best, withVolume[0])
              : null
            const totalSet = rows.reduce((s, a) => s + a.appointmentsSet, 0)
            const totalBookable = rows.reduce((s, a) => s + a.bookableCalls, 0)
            const avgConversion = totalBookable > 0 ? Math.round((totalSet / totalBookable) * 1000) / 10 : null
            const totalNewRevenue = rows.reduce((s, a) => s + a.revenue_new, 0)
            const totalFollowupRevenue = rows.reduce((s, a) => s + a.revenue_followup, 0)
            const byConversion = [...rows].sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0))
            const byNoShow = [...rows].filter(a => a.no_show_rate != null).sort((a, b) => (a.no_show_rate ?? 0) - (b.no_show_rate ?? 0))
            const byAgentRank = new Map(byConversion.map((a, i) => [a.agent, i]))
            const totalPatientsWithAppointments = agentPerf?.total_patients_with_appointments ?? 0
            const invoiceWorkflowStatusChanges = agentPerf?.invoice_workflow_status_changes ?? { booked_to_completed: 0, booked_to_no_show: 0 }
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <KPICard label="Active Agents" value={rows.length} tone="text-slate-800"
                    tooltip="Agents with any incoming, outgoing, outbound, or confirmation activity this period." />
                  <KPICard label="Top Performer" value={topAgent ? topAgent.agent : '—'} tone="text-teal-600"
                    sub={topAgent ? `${topAgent.conversionRate}% conversion` : undefined}
                    tooltip="Highest blended conversion rate (incoming + outgoing + outbound appointments set ÷ calls) among agents with 5+ calls." />
                  <KPICard label="Avg Conversion Rate" value={avgConversion != null ? `${avgConversion}%` : '—'} tone="text-teal-600"
                    tooltip="Total appointments set ÷ total calls, blended across incoming, outgoing follow-up, and outbound." />
                  <KPICard label="New Patient Revenue" value={money(totalNewRevenue)} tone="text-emerald-600"
                    sub={`Follow-up: ${money(totalFollowupRevenue)}`}
                    tooltip="Invoice revenue attributed to NEW patients whose appointment was set by an agent this period — the number that reflects that agent's acquisition effort. Follow-up/returning-patient revenue is shown separately since it isn't driven by this period's calls." />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Panel title="Conversion Rate by Agent" subtitle="Appointments set ÷ calls handled (incoming + outgoing + outbound) — best to worst">
                    <BarList items={byConversion.map(a => ({ label: a.agent, count: a.conversionRate ?? 0 }))} unit="%" />
                  </Panel>
                  <Panel title="Calls vs Appointments by Agent" subtitle="Appointments set (bright) against total calls handled (muted context), all channels combined">
                    <DualBarChart
                      rows={rows.map(a => ({ name: a.agent, primary: a.appointmentsSet, secondary: a.totalCalls }))}
                      primaryLabel="Appointments set" secondaryLabel="Total calls" primaryColor="bg-teal-500" primaryText="text-teal-700"
                    />
                  </Panel>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-1">Call Volume by Channel</h3>
                  <p className="text-xs text-slate-400 mb-3">Same agents, one chart per channel — not blended into a single call count.</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Panel title="Incoming Calls by Agent" subtitle="New leads calling in, highest to lowest">
                      <BarList items={[...rows].sort((a, b) => b.incoming - a.incoming).map(a => ({ label: a.agent, count: a.incoming }))} colorFor={() => CHANNEL_COLOR_CLASS.incoming} />
                    </Panel>
                    <Panel title="Outgoing Follow-up Calls by Agent" subtitle="Follow-up calls to existing leads, highest to lowest">
                      <BarList items={[...rows].sort((a, b) => b.outgoing_leads - a.outgoing_leads).map(a => ({ label: a.agent, count: a.outgoing_leads }))} colorFor={() => CHANNEL_COLOR_CLASS.outgoing} />
                    </Panel>
                    <Panel title="Confirmation Calls by Agent" subtitle="Night-before / morning-of confirmation calls, highest to lowest">
                      <BarList items={[...rows].sort((a, b) => b.confirmation - a.confirmation).map(a => ({ label: a.agent, count: a.confirmation }))} colorFor={() => CHANNEL_COLOR_CLASS.confirmation} />
                    </Panel>
                    <Panel title="Outbound Calls by Agent" subtitle="Outbound queue dials, highest to lowest">
                      <BarList items={[...rows].sort((a, b) => b.outbound - a.outbound).map(a => ({ label: a.agent, count: a.outbound }))} colorFor={() => CHANNEL_COLOR_CLASS.outbound} />
                    </Panel>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Panel title="No-Show Rate by Agent" subtitle="Invoice-validated — share of that agent's past appointments with no matching invoice">
                    <StatusMeterList
                      items={byNoShow.map(a => ({ label: a.agent, value: a.no_show_rate ?? 0, sub: `${a.no_shows}/${a.appointments_set}` }))}
                      thresholds={{ warn: 20, critical: 40 }}
                    />
                  </Panel>
                  <Panel title="Revenue by Agent" subtitle="New patient revenue (the effort signal) vs. follow-up revenue, shown side by side">
                    <DualBarChart
                      rows={rows.map(a => ({ name: a.agent, primary: a.revenue_new, secondary: a.revenue_followup }))}
                      primaryLabel="New patient" secondaryLabel="Follow-up" formatter={money}
                    />
                  </Panel>
                </div>

                <Panel
                  title="Calendar Status Changes by Agent"
                  subtitle={`Appointments moved from Booked → Completed or Booked → No-show — by agent and by the automated invoice-reconciliation workflow — against the ${totalPatientsWithAppointments.toLocaleString()} total patients with an appointment this period`}
                >
                  <StatusChangeStackedChart
                    rows={[
                      ...rows.map(a => ({ name: a.agent, completed: a.booked_to_completed, noShow: a.booked_to_no_show, total: totalPatientsWithAppointments })),
                      {
                        name: 'Invoice Workflow (Automated)',
                        completed: invoiceWorkflowStatusChanges.booked_to_completed,
                        noShow: invoiceWorkflowStatusChanges.booked_to_no_show,
                        total: totalPatientsWithAppointments,
                      },
                    ]}
                    totalLabel="Total patients with appointments"
                  />
                </Panel>

                <Panel
                  title="Calendar Status Changes — All Agents Combined"
                  subtitle="Every Booked → Completed/No-show change this period, stacked together into one bar and color-coded by who made it — the gray segment is how many of this period's appointments still haven't been updated at all"
                >
                  <CombinedStatusChangeStackedChart
                    rows={[
                      ...rows.map(a => ({ name: a.agent, changed: a.booked_to_completed + a.booked_to_no_show })),
                      { name: 'Invoice Workflow (Automated)', changed: invoiceWorkflowStatusChanges.booked_to_completed + invoiceWorkflowStatusChanges.booked_to_no_show },
                    ]}
                    total={totalPatientsWithAppointments}
                  />
                </Panel>

                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-1">Agent Detail</h3>
                  <p className="text-xs text-slate-400 mb-3">Every metric broken out per agent — not blended into one number.</p>
                  {rows.length === 0 ? (
                    <p className="text-sm text-slate-400">No agent activity this period.</p>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {rows.map(a => (
                        <AgentDetailCard key={a.agent} a={a} rank={byAgentRank.get(a.agent)} money={money} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {tab === 'channels' && (() => {
            if (sourcePerfLoading) {
              return (
                <div className="space-y-2">
                  {[0, 1, 2, 3].map(i => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}
                </div>
              )
            }
            if (sourcePerfError) {
              return <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-md p-3">{sourcePerfError}</div>
            }
            const sourceRows = ((sourcePerf?.sources || []) as SourcePerfRow[]).map(s => {
              const attendedRate = s.appointments_eligible > 0
                ? Math.round((1 - s.no_shows / s.appointments_eligible) * 1000) / 10
                : null
              const newShare = s.leads > 0 ? Math.round((s.new_leads / s.leads) * 100) : null
              return { ...s, attendedRate, newShare }
            })
            const totalLeads = sourceRows.reduce((s, r) => s + r.leads, 0)
            const totalNew = sourceRows.reduce((s, r) => s + r.new_leads, 0)
            const totalOld = sourceRows.reduce((s, r) => s + r.old_leads, 0)
            const totalNewRevenue = sourceRows.reduce((s, r) => s + r.revenue_new, 0)
            const byLeads = [...sourceRows].sort((a, b) => b.leads - a.leads)
            const byAttended = [...sourceRows].filter(s => s.attendedRate != null).sort((a, b) => (b.attendedRate ?? 0) - (a.attendedRate ?? 0))
            return (
              <div className="space-y-4">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-500 space-y-1.5">
                  <p>
                    Source identity: <span className="font-medium text-slate-700">crm_leads → lead_attribution.source_category</span>,
                    falling back to <span className="font-medium text-slate-700">crm_leads.source</span> when unattributed.
                    Revenue: <span className="font-medium text-slate-700">crm_invoice_reconciliation</span> (matched/approved only) →{' '}
                    <span className="font-medium text-slate-700">invoices</span>. Attendance: invoice-validated within ±7 days of the appointment,
                    same rule used across the whole dashboard.
                  </p>
                  <p>
                    Every real source (<span className="font-medium text-slate-700">facebook</span>, <span className="font-medium text-slate-700">Facebook Page / Messenger</span>,{' '}
                    <span className="font-medium text-slate-700">Facebook Ad</span>, etc.) is folded into one <span className="font-medium text-slate-700">Facebook</span> bucket
                    instead of splitting the same channel across near-duplicate labels.
                  </p>
                  <p>
                    Every appointment on this tab should trace back to a Lead Intake record (<span className="font-medium text-slate-700">crm_leads</span>) — that&apos;s the
                    normal path and where source/agent/patient-type attribution comes from. Two buckets below are appointments that don&apos;t, by design or by history, not a bug:
                    {' '}<span className="font-medium text-slate-700">Outbound Follow-up</span> — booked via the outbound call queue for an existing patient (has an agent and
                    patient, just no lead, since the queue is fed from existing patients, not fresh leads); and{' '}
                    <span className="font-medium text-slate-700">Unattributed / Historical</span> — bulk-imported from the old external call-center log before Lead Intake
                    existed, with no attribution recoverable.
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <KPICard label="Active Sources" value={sourceRows.length} tone="text-slate-800"
                    tooltip="Distinct lead sources with at least one lead this period." />
                  <KPICard label="Top Source" value={byLeads[0]?.source ?? '—'} tone="text-teal-600"
                    sub={byLeads[0] ? `${byLeads[0].leads} leads` : undefined}
                    tooltip="Source with the most leads this period." />
                  <KPICard label="New vs Old Leads" value={`${totalNew} / ${totalOld}`} tone="text-indigo-600"
                    sub={totalLeads > 0 ? `${Math.round((totalNew / totalLeads) * 100)}% new` : undefined}
                    tooltip="New-patient leads vs returning/Old-patient leads, across all sources this period." />
                  <KPICard label="New Patient Revenue" value={money(totalNewRevenue)} tone="text-emerald-600"
                    tooltip="Invoice revenue (via crm_invoice_reconciliation) attributed to NEW patients whose lead traces to a source this period." />
                </div>

                {(() => {
                  const ptFunnel = (sourcePerf?.patient_type_funnel || []) as { type: string; leads: number; appointments_set: number; attended: number }[]
                  const newFunnel = ptFunnel.find(p => p.type === 'New')
                  const oldFunnel = ptFunnel.find(p => p.type === 'Old')
                  if (!newFunnel && !oldFunnel) return null
                  return (
                    <Panel title="New vs Old Patient Funnel" subtitle="Leads → Appointments Set → Attended, combined across every source, split by patient type">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <div className="text-xs font-semibold text-indigo-700 mb-2">New Patients</div>
                          <FunnelChart steps={[
                            { label: 'Leads', count: newFunnel?.leads ?? 0, hint: 'first-time patients, created this period' },
                            { label: 'Appointments Set', count: newFunnel?.appointments_set ?? 0, hint: 'appointments dated this period' },
                            { label: 'Attended', count: newFunnel?.attended ?? 0, hint: 'invoice-validated show-up' },
                          ]} />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-slate-500 mb-2">Old / Returning Patients</div>
                          <FunnelChart steps={[
                            { label: 'Leads', count: oldFunnel?.leads ?? 0, hint: 'returning patients, created this period' },
                            { label: 'Appointments Set', count: oldFunnel?.appointments_set ?? 0, hint: 'appointments dated this period' },
                            { label: 'Attended', count: oldFunnel?.attended ?? 0, hint: 'invoice-validated show-up' },
                          ]} />
                        </div>
                      </div>
                    </Panel>
                  )
                })()}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Panel title="Lead Source Distribution" subtitle="Share of leads by source this period">
                    <DonutChart items={sourceRows.map(s => ({ label: s.source, count: s.leads }))} />
                  </Panel>
                  <Panel title="New vs Old Leads by Source" subtitle="New-patient leads (the acquisition signal) vs returning/Old, per source">
                    <DualBarChart
                      rows={sourceRows.map(s => ({ name: s.source, primary: s.new_leads, secondary: s.old_leads }))}
                      primaryLabel="New patient" secondaryLabel="Old / returning"
                    />
                  </Panel>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Panel title="Attended Rate by Source" subtitle="Invoice-validated — share of that source's past appointments that were actually attended">
                    <StatusMeterList
                      items={byAttended.map(s => ({ label: s.source, value: s.attendedRate ?? 0, sub: `${s.appointments_eligible - s.no_shows}/${s.appointments_eligible}` }))}
                      thresholds={{ warn: 80, critical: 60 }}
                      higherIsBetter
                    />
                  </Panel>
                  <Panel title="Revenue by Source" subtitle="New patient revenue (the acquisition signal) vs follow-up, per source">
                    <DualBarChart
                      rows={sourceRows.map(s => ({ name: s.source, primary: s.revenue_new, secondary: s.revenue_followup }))}
                      primaryLabel="New patient" secondaryLabel="Follow-up" formatter={money}
                    />
                  </Panel>
                </div>

                {(() => {
                  const tta = (sourcePerf?.time_to_appointment || []) as { source: string; median_days: number; avg_days: number; n: number }[]
                  if (tta.length === 0) return null
                  return (
                    <Panel title="Time to First Appointment by Source" subtitle="Median days from lead created to first appointment set — fastest to slowest">
                      <BarList items={tta.map(t => ({ label: t.source, count: t.median_days }))} unit=" days" />
                    </Panel>
                  )
                })()}

                {(() => {
                  const matrix = (sourcePerf?.source_agent_matrix || []) as { source: string; agent: string; leads: number }[]
                  if (matrix.length === 0) return null
                  const sources = [...new Set(matrix.map(m => m.source))].sort((a, b) => {
                    const totalA = matrix.filter(m => m.source === a).reduce((s, m) => s + m.leads, 0)
                    const totalB = matrix.filter(m => m.source === b).reduce((s, m) => s + m.leads, 0)
                    return totalB - totalA
                  })
                  const agents = [...new Set(matrix.map(m => m.agent))].sort()
                  const cell = new Map(matrix.map(m => [`${m.source}|${m.agent}`, m.leads]))
                  const max = Math.max(1, ...matrix.map(m => m.leads))
                  return (
                    <Panel title="Source × Agent Matrix" subtitle="Which agents actually work which channels — leads handled, per source per agent">
                      <div className="overflow-x-auto">
                        <table className="text-sm border-collapse">
                          <thead>
                            <tr>
                              <th className="text-left pb-2 pr-3 text-xs text-slate-400 font-medium">Source</th>
                              {agents.map(ag => <th key={ag} className="pb-2 px-2 text-xs text-slate-400 font-medium text-center whitespace-nowrap">{ag}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {sources.map(src => (
                              <tr key={src}>
                                <td className="py-1 pr-3 font-medium text-slate-700 whitespace-nowrap">{src}</td>
                                {agents.map(ag => {
                                  const v = cell.get(`${src}|${ag}`) ?? 0
                                  const intensity = v / max
                                  return (
                                    <td key={ag} className="p-1 text-center">
                                      <div
                                        className="w-14 h-8 rounded-md flex items-center justify-center text-xs font-semibold tabular-nums mx-auto"
                                        style={{
                                          backgroundColor: v > 0 ? `rgba(13, 148, 136, ${0.12 + intensity * 0.75})` : 'transparent',
                                          color: intensity > 0.5 ? 'white' : v > 0 ? '#0f766e' : '#cbd5e1',
                                        }}
                                      >
                                        {v > 0 ? v : '—'}
                                      </div>
                                    </td>
                                  )
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Panel>
                  )
                })()}

                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-1">Source Detail</h3>
                  <p className="text-xs text-slate-400 mb-3">Full funnel per source — leads in, appointments set, and who actually showed up.</p>
                  {sourceRows.length === 0 ? (
                    <p className="text-sm text-slate-400">No source activity this period.</p>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {byLeads.map((s, i) => (
                        <SourceDetailCard key={s.source} s={s} rank={i} money={money} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

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
            <div className="space-y-4">
              <Panel title="Marketing Attribution" subtitle="Canonical CRM source attribution, validated invoice revenue, and patient-linked evidence">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                    <div className="font-medium text-slate-700 mb-1">Lead source</div>
                    <div className="text-slate-500">crm_leads → lead_attribution → patient_marketing_attribution</div>
                    <div className="mt-2 text-slate-700">{metrics.validation?.attributed_leads ?? '—'} attributed leads</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                    <div className="font-medium text-slate-700 mb-1">Validated revenue</div>
                    <div className="text-slate-500">crm_invoice_reconciliation → invoices → invoice_line_items</div>
                    <div className="mt-2 text-slate-700">{metrics.validation?.approved_invoice_matches ?? '—'} approved invoice matches</div>
                  </div>
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                    <div className="font-medium text-amber-800 mb-1">Review boundary</div>
                    <div className="text-amber-700">Needs-review and duplicate candidates are excluded from validated revenue.</div>
                    <div className="mt-2 text-amber-800">{metrics.validation?.invoice_matches_needing_review ?? '—'} need review</div>
                  </div>
                </div>
              </Panel>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel title="Lead Source" subtitle="Lead counts grouped from canonical source attribution; fallback is crm_leads.source">
                <DonutChart
                  items={(metrics.by_source || []).map((s: any) => ({ label: s.source, count: s.count }))}
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
              <Panel title="Doctor Performance" subtitle="Appointments, no-show rate, and revenue per doctor">
                <DoctorTable rows={(metrics.by_doctor_performance || []).map((d: any) => ({
                  doctor: d.doctor,
                  appointments: d.appointments,
                  no_show_rate: d.no_show_rate,
                  revenue: d.revenue,
                }))} />
              </Panel>
              <Panel title="Agent Performance" subtitle="Leads vs bookings per agent — bar shows leads (grey) and booked (teal)">
                <AgentTable rows={(metrics.by_agent || []).map((a: any) => ({
                  agent: a.agent,
                  leads: a.leads,
                  booked: a.booked,
                  booking_rate: a.booking_rate,
                }))} />
              </Panel>
              </div>
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

              <Panel
                title="Field Confirmations"
                subtitle="Staff-confirmed edits to appointment status, patient name/phone, or hospital ID from the Calendar's confirmation call sheet"
              >
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                  <KPICard label="Total Confirmations" value={metrics.field_confirmations?.total ?? 0} tone="text-slate-800"
                    tooltip="Every explicitly-confirmed edit to status, patient name/phone, or hospital ID in this period, attributed to the logged-in staff member who made it." />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs font-medium text-slate-500 mb-2">By Field</div>
                    <BarList
                      items={(metrics.field_confirmations?.by_field || []).map((s: any) => ({ label: s.field, count: s.count }))}
                    />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-500 mb-2">By Agent</div>
                    <BarList
                      items={(metrics.field_confirmations?.by_agent || []).map((s: any) => ({ label: s.agent, count: s.count }))}
                    />
                  </div>
                </div>
              </Panel>

              <Panel
                title="Recompute Appointment Status"
                subtitle="Overwrites appointment_status (Completed/No-show) from the invoice source of truth for the chosen range — Scheduled/Cancelled/Rescheduled are left alone"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => recomputeStatusFromInvoices('2026-06-01')}
                    disabled={syncing}
                    className="bg-teal-600 text-white px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50"
                  >
                    {syncing ? 'Recomputing…' : 'Recompute June 2026 onward'}
                  </button>
                  <button
                    onClick={() => recomputeStatusFromInvoices(null)}
                    disabled={syncing}
                    className="border border-slate-300 text-slate-600 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                  >
                    {syncing ? 'Recomputing…' : 'Recompute entire history'}
                  </button>
                  {syncMsg && <span className="text-xs text-slate-500">{syncMsg}</span>}
                </div>
              </Panel>
            </div>
          )}
        </>
      )}

      {tab === 'ad_attribution' && (
        <div className="space-y-4">
          <Panel
            title="Facebook Ad Attribution"
            subtitle="Leads, bookings, appointments, and revenue attributed to each ad via Messenger conversations — reconciled nightly"
          >
            {adError && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-md p-3 mb-3">{adError}</div>}
            {adLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map(i => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}
              </div>
            ) : !adRows || adRows.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">
                No attributed ad data for this period. Attribution runs nightly via Messenger reconciliation.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="pb-2 pr-4 font-medium">Campaign</th>
                      <th className="pb-2 pr-4 font-medium">Ad</th>
                      <th className="pb-2 pr-4 font-medium text-right">Leads</th>
                      <th className="pb-2 pr-4 font-medium text-right">Booked</th>
                      <th className="pb-2 pr-4 font-medium text-right">Appts</th>
                      <th className="pb-2 pr-4 font-medium text-right">Completed</th>
                      <th className="pb-2 font-medium text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {adRows.map((row: any, i: number) => {
                      const bookRate = row.leads > 0 ? Math.round((row.booked / row.leads) * 100) : 0
                      const completeRate = row.appointments > 0 ? Math.round((row.completed / row.appointments) * 100) : 0
                      return (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="py-2 pr-4 text-slate-700 max-w-[180px] truncate" title={row.campaign_name || row.campaign_id}>
                            {row.campaign_name || row.campaign_id || '—'}
                          </td>
                          <td className="py-2 pr-4 text-slate-600 max-w-[200px] truncate" title={row.ad_name || row.ad_id}>
                            {row.ad_name || row.ad_id || '—'}
                          </td>
                          <td className="py-2 pr-4 text-right font-medium">{row.leads}</td>
                          <td className="py-2 pr-4 text-right">
                            <span className="font-medium">{row.booked}</span>
                            <span className="text-slate-400 text-xs ml-1">({bookRate}%)</span>
                          </td>
                          <td className="py-2 pr-4 text-right">{row.appointments}</td>
                          <td className="py-2 pr-4 text-right">
                            <span className="font-medium text-emerald-600">{row.completed}</span>
                            {row.appointments > 0 && <span className="text-slate-400 text-xs ml-1">({completeRate}%)</span>}
                          </td>
                          <td className="py-2 text-right font-medium text-emerald-700">{money(row.revenue)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 text-xs text-slate-500">
                      <td colSpan={2} className="pt-2 pr-4">Totals</td>
                      <td className="pt-2 pr-4 text-right font-medium text-slate-700">{adRows.reduce((s: number, r: any) => s + r.leads, 0)}</td>
                      <td className="pt-2 pr-4 text-right font-medium text-slate-700">{adRows.reduce((s: number, r: any) => s + r.booked, 0)}</td>
                      <td className="pt-2 pr-4 text-right font-medium text-slate-700">{adRows.reduce((s: number, r: any) => s + r.appointments, 0)}</td>
                      <td className="pt-2 pr-4 text-right font-medium text-emerald-600">{adRows.reduce((s: number, r: any) => s + r.completed, 0)}</td>
                      <td className="pt-2 text-right font-medium text-emerald-700">{money(adRows.reduce((s: number, r: any) => s + r.revenue, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}

// ── StatusMeterList — a labeled row of status-colored meters (good/warn/critical) ──
function StatusMeterList({
  items, thresholds, higherIsBetter = false,
}: {
  items: { label: string; value: number; sub?: string }[]
  thresholds: { warn: number; critical: number }
  higherIsBetter?: boolean
}) {
  if (items.length === 0) return <p className="text-sm text-slate-400">No eligible data for this period.</p>
  const statusFor = (v: number) => higherIsBetter
    ? (v <= thresholds.critical ? 'critical' : v <= thresholds.warn ? 'warn' : 'good')
    : (v >= thresholds.critical ? 'critical' : v >= thresholds.warn ? 'warn' : 'good')
  const barColor = { good: 'bg-emerald-500', warn: 'bg-amber-500', critical: 'bg-rose-500' }
  const textColor = { good: 'text-emerald-600', warn: 'text-amber-600', critical: 'text-rose-600' }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-[10px] text-slate-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Good</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />Warning</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />Critical</span>
      </div>
      {items.map(item => {
        const status = statusFor(item.value)
        return (
          <div key={item.label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-slate-700">{item.label}</span>
              <span className={`font-bold tabular-nums ${textColor[status]}`}>
                {item.value}% {item.sub && <span className="font-normal text-slate-400">({item.sub})</span>}
              </span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${barColor[status]}`} style={{ width: `${Math.min(100, item.value)}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── DualBarChart — emphasis form: a primary metric (bold color) against a
// de-emphasized secondary one, per row. Used for New vs Follow-up revenue
// and New vs Old leads - anywhere one number is the point and the other is
// context. ──
function DualBarChart({
  rows, primaryLabel, secondaryLabel, primaryColor = 'bg-emerald-500', primaryText = 'text-emerald-700',
  formatter = (n: number) => String(n), sortDesc = true,
}: {
  rows: { name: string; primary: number; secondary: number }[]
  primaryLabel: string
  secondaryLabel: string
  primaryColor?: string
  primaryText?: string
  formatter?: (n: number) => string
  sortDesc?: boolean
}) {
  if (rows.length === 0) return <p className="text-sm text-slate-400">No data for this period.</p>
  const max = Math.max(1, ...rows.map(r => Math.max(r.primary, r.secondary)))
  const sorted = sortDesc ? [...rows].sort((a, b) => b.primary - a.primary) : rows
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-[10px] text-slate-400">
        <span className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full inline-block ${primaryColor}`} />{primaryLabel}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300 inline-block" />{secondaryLabel}</span>
      </div>
      {sorted.map(r => (
        <div key={r.name}>
          <div className="text-xs font-medium text-slate-700 mb-1">{r.name}</div>
          <div className="flex items-center gap-2 mb-1">
            <div className="flex-1 h-3.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${primaryColor}`} style={{ width: `${(r.primary / max) * 100}%` }} />
            </div>
            <div className={`w-24 text-right text-xs font-semibold tabular-nums ${primaryText}`}>{formatter(r.primary)}</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-slate-300 rounded-full" style={{ width: `${(r.secondary / max) * 100}%` }} />
            </div>
            <div className="w-24 text-right text-xs text-slate-500 tabular-nums">{formatter(r.secondary)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── StatusChangeStackedChart — Booked→Completed and Booked→No-show stack
// into a single cumulative bar per agent (since both are agent-driven
// changes off the same starting "Booked" pool, not independent metrics), with
// a muted reference bar underneath showing the total patients-with-appointments
// figure they're being measured against. ──
function StatusChangeStackedChart({
  rows, totalLabel,
}: {
  rows: { name: string; completed: number; noShow: number; total: number }[]
  totalLabel: string
}) {
  if (rows.length === 0) return <p className="text-sm text-slate-400">No data for this period.</p>
  const max = Math.max(1, ...rows.map(r => Math.max(r.completed + r.noShow, r.total)))
  const sorted = [...rows].sort((x, y) => (y.completed + y.noShow) - (x.completed + x.noShow))
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-[10px] text-slate-400 flex-wrap">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block bg-emerald-500" />Booked → Completed</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block bg-rose-500" />Booked → No-show</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block bg-slate-400" />{totalLabel}</span>
      </div>
      {sorted.map(r => {
        const changed = r.completed + r.noShow
        return (
          <div key={r.name}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-slate-700">{r.name}</span>
              <span className="text-slate-500 tabular-nums">
                <span className="text-emerald-700 font-semibold">{r.completed}</span>
                {' + '}
                <span className="text-rose-700 font-semibold">{r.noShow}</span>
                {' = '}
                <span className="font-semibold text-slate-700">{changed}</span>
              </span>
            </div>
            <div
              className="flex h-3.5 bg-slate-100 rounded-full overflow-hidden mb-1"
              title={`${r.completed} Booked → Completed, ${r.noShow} Booked → No-show`}
            >
              {r.completed > 0 && <div className="h-full bg-emerald-500" style={{ width: `${(r.completed / max) * 100}%` }} />}
              {r.noShow > 0 && <div className="h-full bg-rose-500" style={{ width: `${(r.noShow / max) * 100}%` }} />}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-slate-400 rounded-full" style={{ width: `${(r.total / max) * 100}%` }} />
              </div>
              <div className="w-20 text-right text-xs text-slate-500 tabular-nums">{r.total}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Same categorical palette as DonutChart (components/admin/DashboardCharts.tsx),
// so an agent's color reads consistently across charts on this tab.
const AGENT_PALETTE_HEX = ['#0d9488', '#6366f1', '#f59e0b', '#10b981', '#f43f5e', '#8b5cf6', '#e87ba4', '#eb6834']

// ── CombinedStatusChangeStackedChart — every changer (agents + the automated
// invoice workflow) combined into ONE bar, color-coded per changer, so the
// total volume and the coverage gap (patients whose appointment was never
// updated at all) read at a glance instead of needing to sum per-agent rows. ──
function CombinedStatusChangeStackedChart({
  rows, total,
}: {
  rows: { name: string; changed: number }[]
  total: number
}) {
  if (total <= 0) return <p className="text-sm text-slate-400">No data for this period.</p>
  const withVolume = rows.filter(r => r.changed > 0).sort((a, b) => b.changed - a.changed)
  const totalChanged = withVolume.reduce((s, r) => s + r.changed, 0)
  const missing = Math.max(0, total - totalChanged)
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-1">
        <div className="text-sm text-slate-600">
          <span className="font-semibold text-slate-800 tabular-nums">{totalChanged.toLocaleString()}</span> of{' '}
          <span className="font-semibold text-slate-800 tabular-nums">{total.toLocaleString()}</span> patients updated
        </div>
        <div className={`text-xs font-semibold tabular-nums ${missing > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
          {missing.toLocaleString()} still not updated
        </div>
      </div>
      <div className="flex h-6 bg-slate-100 rounded-full overflow-hidden">
        {withVolume.map((r, i) => (
          <div
            key={r.name}
            className="h-full"
            style={{ width: `${(r.changed / total) * 100}%`, backgroundColor: AGENT_PALETTE_HEX[i % AGENT_PALETTE_HEX.length] }}
            title={`${r.name}: ${r.changed}`}
          />
        ))}
        {missing > 0 && (
          <div className="h-full bg-slate-300" style={{ width: `${(missing / total) * 100}%` }} title={`Not yet updated: ${missing}`} />
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
        {withVolume.map((r, i) => (
          <span key={r.name} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0" style={{ backgroundColor: AGENT_PALETTE_HEX[i % AGENT_PALETTE_HEX.length] }} />
            {r.name} <span className="font-semibold text-slate-700 tabular-nums">{r.changed}</span>
          </span>
        ))}
        {missing > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm inline-block bg-slate-300 flex-shrink-0" />
            Not yet updated <span className="font-semibold text-slate-700 tabular-nums">{missing}</span>
          </span>
        )}
      </div>
    </div>
  )
}

// ── AgentDetailCard — one visual box per agent with every metric broken out ──
function ChannelMeter({ label, value, color, sub }: { label: string; value: number | null; color: string; sub: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: color }} />
          {label}
        </span>
        <span className="font-semibold tabular-nums text-slate-700">{value != null ? `${value}%` : '—'} <span className="font-normal text-slate-400">({sub})</span></span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, value ?? 0)}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

function AgentDetailCard({ a, rank, money }: { a: AgentDetailRow; rank: number | undefined; money: (n: number) => string }) {
  const noShowRate = a.no_show_rate ?? 0
  const noShowTone = noShowRate >= 40 ? 'bg-rose-50 text-rose-700' : noShowRate >= 20 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
  const incomingRate = a.incoming > 0 ? Math.round((a.incoming_booked / a.incoming) * 100) : null
  const outgoingRate = a.outgoing_leads > 0 ? Math.round((a.outgoing_leads_booked / a.outgoing_leads) * 100) : null
  const outboundRate = a.outbound > 0 ? Math.round((a.outbound_booked / a.outbound) * 100) : null

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {rank === 0 && <span title="Top performer this period">🏆</span>}
          <h3 className="font-semibold text-slate-800">{a.agent}</h3>
        </div>
        <span className="text-xs font-bold text-teal-600 tabular-nums">{a.conversionRate != null ? `${a.conversionRate}%` : '—'} conv.</span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-emerald-50 rounded-lg py-2 px-1">
          <div className="text-[10px] text-emerald-700 font-medium">New Revenue</div>
          <div className="text-sm font-bold text-emerald-700 tabular-nums">{money(a.revenue_new)}</div>
        </div>
        <div className="bg-slate-50 rounded-lg py-2 px-1">
          <div className="text-[10px] text-slate-500 font-medium">Follow-up Rev.</div>
          <div className="text-sm font-bold text-slate-600 tabular-nums">{money(a.revenue_followup)}</div>
        </div>
        <div className={`rounded-lg py-2 px-1 ${noShowTone}`}>
          <div className="text-[10px] font-medium">No-show Rate</div>
          <div className="text-sm font-bold tabular-nums">{a.no_show_rate != null ? `${a.no_show_rate}%` : '—'}</div>
        </div>
      </div>

      <div className="space-y-2.5">
        <ChannelMeter label="Incoming" value={incomingRate} color={CHANNEL_COLORS.incoming} sub={`${a.incoming_booked}/${a.incoming} set`} />
        <ChannelMeter label="Outgoing Follow-up" value={outgoingRate} color={CHANNEL_COLORS.outgoing} sub={`${a.outgoing_leads_booked}/${a.outgoing_leads} set`} />
        <ChannelMeter label="Outbound" value={outboundRate} color={CHANNEL_COLORS.outbound} sub={`${a.outbound_booked}/${a.outbound} set`} />
        {a.confirmation > 0 && (
          <ChannelMeter label="Confirmation Calls" value={a.confirmRate} color={CHANNEL_COLORS.confirmation} sub={`${a.confirmation_confirmed}/${a.confirmation} confirmed`} />
        )}
      </div>

      {a.outbound > 0 && (
        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 text-center">
          <div>
            <div className="text-[10px] text-slate-400">Reached</div>
            <div className="text-xs font-semibold text-slate-700 tabular-nums">{a.reachedRate != null ? `${a.reachedRate}%` : '—'}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Attended</div>
            <div className="text-xs font-semibold text-slate-700 tabular-nums">
              {a.outboundAttendedRate != null ? `${a.outboundAttendedRate}%` : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Dials / Appt</div>
            <div className="text-xs font-semibold text-slate-700 tabular-nums">{a.attempts_per_booking ?? '—'}</div>
          </div>
        </div>
      )}

      {a.outbound_outcomes.length > 0 && (
        <div className="pt-3 border-t border-slate-100">
          <div className="text-[10px] text-slate-400 mb-1.5">Outbound call outcomes — every dial, not just reached/booked</div>
          <BarList
            items={a.outbound_outcomes.map(o => ({ label: OUTBOUND_OUTCOME_LABEL[o.outcome] || o.outcome, count: o.count }))}
            colorFor={(label) => OUTBOUND_OUTCOME_COLORS[label] || 'bg-slate-400'}
          />
        </div>
      )}
    </div>
  )
}

// ── SourceDetailCard — one visual box per source: full funnel (leads -> set
// -> attended), New/Old composition, and revenue split. ──
function SourceDetailCard({ s, rank, money }: { s: SourcePerfRow; rank: number | undefined; money: (n: number) => string }) {
  const noShowRate = s.appointments_eligible > 0 ? Math.round((s.no_shows / s.appointments_eligible) * 1000) / 10 : null
  const noShowTone = (noShowRate ?? 0) >= 40 ? 'bg-rose-50 text-rose-700' : (noShowRate ?? 0) >= 20 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {rank === 0 && <span title="Top source by volume this period">🏆</span>}
          <h3 className="font-semibold text-slate-800">{s.source}</h3>
        </div>
        <span className="text-xs font-bold text-indigo-600 tabular-nums">{s.newShare != null ? `${s.newShare}%` : '—'} new</span>
      </div>

      <DualBarChart
        rows={[
          { name: 'Leads', primary: s.new_leads, secondary: s.old_leads },
          { name: 'Appointments Set', primary: s.new_appointments_set, secondary: s.old_appointments_set },
          { name: 'Attended', primary: s.new_attended, secondary: s.old_attended },
        ]}
        primaryLabel="New patient" secondaryLabel="Old / returning"
        primaryColor="bg-indigo-500" primaryText="text-indigo-700"
        sortDesc={false}
      />

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-indigo-50 rounded-lg py-2 px-1">
          <div className="text-[10px] text-indigo-700 font-medium">New Leads</div>
          <div className="text-sm font-bold text-indigo-700 tabular-nums">{s.new_leads}</div>
        </div>
        <div className="bg-slate-50 rounded-lg py-2 px-1">
          <div className="text-[10px] text-slate-500 font-medium">Old Leads</div>
          <div className="text-sm font-bold text-slate-600 tabular-nums">{s.old_leads}</div>
        </div>
        <div className={`rounded-lg py-2 px-1 ${noShowTone}`}>
          <div className="text-[10px] font-medium">No-show Rate</div>
          <div className="text-sm font-bold tabular-nums">{noShowRate != null ? `${noShowRate}%` : '—'}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-100 text-center">
        <div>
          <div className="text-[10px] text-slate-400">New Patient Revenue</div>
          <div className="text-xs font-semibold text-emerald-700 tabular-nums">{money(s.revenue_new)}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">Follow-up Revenue</div>
          <div className="text-xs font-semibold text-slate-600 tabular-nums">{money(s.revenue_followup)}</div>
        </div>
      </div>

    </div>
  )
}

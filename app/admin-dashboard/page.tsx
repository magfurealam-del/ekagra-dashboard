'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { appointmentTypeColor } from '@/lib/appointmentTypeColors'
import { KPICard, BarList, Panel, FunnelChart, DonutChart, AgentTable } from '@/components/admin/DashboardCharts'

import { ExecutiveHeader } from '@/components/admin/ExecutiveHeader'
import { ExecutiveOverview } from '@/components/admin/ExecutiveOverview'
import { Skeleton } from '@/components/ui/skeleton'
import { clinicDate, rangeFor, previousRangeFor, validRange, DASHBOARD_TABS, type RangeKey, type DashboardTab as Tab } from '@/lib/dashboard-presentation'

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
  appointments_set: number; appointments_eligible: number; no_shows: number; no_show_rate: number | null
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
  const [customStart, setCustomStart] = useState(() => `${clinicDate().slice(0, 7)}-01`)
  const [customEnd, setCustomEnd] = useState(() => clinicDate())
  const [compare, setCompare] = useState(true)
  const { start, end } = useMemo(() => rangeFor(rangeKey, customStart, customEnd), [rangeKey, customStart, customEnd])
  const rangeValid = validRange(start, end)
  const prevRange = useMemo(() => validRange(start, end) ? previousRangeFor(start, end) : { start: '', end: '' }, [start, end])
  const [reloadKey, setReloadKey] = useState(0)
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)
  const [prevRefreshedAt, setPrevRefreshedAt] = useState<string | null>(null)
  const [reconciliation, setReconciliation] = useState<{ pending?: boolean; published_at?: string; crm_updated_at?: string; billing_updated_at?: string } | null>(null)

  const [metrics, setMetrics] = useState<any | null>(null)
  const [prevMetrics, setPrevMetrics] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adRows, setAdRows] = useState<any[] | null>(null)
  const [agentPerf, setAgentPerf] = useState<any | null>(null)
  const [sourcePerf, setSourcePerf] = useState<any | null>(null)
  const adLoading = loading
  const agentPerfLoading = loading
  const sourcePerfLoading = loading
  const adError = error
  const agentPerfError = error
  const sourcePerfError = error

  useEffect(() => {
    if (!isAdmin || !rangeValid) return
    let cancelled = false
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 20000)
    setLoading(true)
    setError('')
    setMetrics(null)
    setPrevMetrics(null)
    setRefreshedAt(null)
    setPrevRefreshedAt(null)
    setReconciliation(null)
    setAdRows(null)
    setAgentPerf(null)
    setSourcePerf(null)
    Promise.resolve(supabase.rpc('get_executive_dashboard', { p_start_date: start, p_end_date: end, p_compare: compare }).abortSignal(controller.signal))
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) throw error
        if (!data || data.contract_version !== 2) throw new Error('The reporting contract is unavailable.')
        setMetrics(data.metrics)
        setPrevMetrics(data.previous)
        setRefreshedAt(data.refreshed_at)
        setPrevRefreshedAt(data.previous ? data.refreshed_at : null)
        setAgentPerf(data.agents)
        setSourcePerf(data.sources)
        setAdRows(data.ads)
        setReconciliation(data.reconciliation)
      }).catch((error: { message?: string }) => {
        if (!cancelled) setError(error.message || 'The report could not be loaded. Select Refresh report to try again.')
      }).finally(() => { window.clearTimeout(timeout); if (!cancelled) setLoading(false) })
    return () => { cancelled = true; window.clearTimeout(timeout); controller.abort() }
  }, [start, end, compare, isAdmin, profile?.id, rangeValid, reloadKey])

  function reloadSnapshot() { setReloadKey(key => key + 1) }
  useEffect(() => {
    const onPop = () => {
      const section = new URLSearchParams(window.location.search).get('section')
      setTab(DASHBOARD_TABS.some(item => item.key === section) ? section as Tab : 'overview')
    }
    onPop()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  function selectTab(value: Tab) {
    setTab(value)
    const url = new URL(window.location.href)
    url.searchParams.set('section', value)
    window.history.pushState(null, '', url)
  }

  if (!isAdmin) return null

  const d = (curr: number, key: string) => compare && prevMetrics ? pctDelta(curr, prevMetrics[key]) : undefined

  return (
    <div className="space-y-5 pb-12">
      <ExecutiveHeader rangeKey={rangeKey} setRangeKey={setRangeKey} customStart={customStart} customEnd={customEnd} setCustomStart={setCustomStart} setCustomEnd={setCustomEnd} start={start} end={end} compare={compare} setCompare={setCompare} refreshedAt={refreshedAt} loading={loading} reload={reloadSnapshot} tab={tab} setTab={selectTab} />
      {compare && rangeValid && <p className="text-xs text-slate-600">Comparing with {prevRange.start} – {prevRange.end} (equal-length prior period).{prevRefreshedAt && <> Comparison read: {new Date(prevRefreshedAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })} BDT.</>}{!loading && metrics && !prevMetrics && ' No comparison is available; changes are not estimated.'}</p>}
      {reconciliation && <div className={`rounded-lg border p-3 text-xs leading-relaxed ${reconciliation.pending ? 'border-amber-200 bg-amber-50 text-amber-900' : 'bg-white text-slate-600'}`} role="status">
        All sections and comparison periods share one database read. Contact dates use Bangladesh time.
        {reconciliation.published_at && <> Evidence publication: {new Date(reconciliation.published_at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })} BDT.</>}
        {reconciliation.pending && <strong className="block mt-1">Reconciliation is pending. CRM activity is current; invoice and acquisition evidence may still change after publication.</strong>}
      </div>}
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
      {!rangeValid || error ? null : loading ? (
        <div role="status" aria-label="Loading dashboard" className="space-y-5"><div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-44 rounded-xl" />)}</div><Skeleton className="h-80 rounded-xl" /></div>
      ) : metrics ? (
        <>
          {tab === 'overview' && <ExecutiveOverview metrics={metrics} previous={prevMetrics} compare={compare} onSelect={selectTab} />}

          {tab === 'agents' && (() => {
            type AgentPerfRow = {
              agent: string
              incoming: number; incoming_booked: number
              outgoing_leads: number; outgoing_leads_booked: number
              outbound: number; outbound_reached: number; outbound_booked: number
              outbound_outcomes: { outcome: string; count: number }[]
              outbound_appointments_set: number; outbound_appointments_eligible: number; outbound_appointments_attended: number
              confirmation: number; confirmation_confirmed: number
              appointments_set: number; appointments_eligible: number; no_shows: number; no_show_rate: number | null
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
                  <KPICard label="CRM revenue · New lead type" value={money(totalNewRevenue)} tone="text-emerald-600"
                    sub={`Other lead types: ${money(totalFollowupRevenue)}`}
                    tooltip="CRM-linked invoice revenue by invoice date and recorded lead patient type. This is not first-visit acquisition revenue or an estimate of agent causality." />
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
                  <Panel title="No-Show Rate by Agent" subtitle="Recorded no-shows divided by eligible appointments; missing invoices are unresolved">
                    <StatusMeterList
                      items={byNoShow.map(a => ({ label: a.agent, value: a.no_show_rate ?? 0, sub: `${a.no_shows}/${a.appointments_eligible}` }))}
                    />
                  </Panel>
                  <Panel title="Revenue by Agent" subtitle="CRM-linked invoices by invoice date, split by recorded lead patient type; not a measure of agent causality">
                    <DualBarChart
                      rows={rows.map(a => ({ name: a.agent, primary: a.revenue_new, secondary: a.revenue_followup }))}
                      primaryLabel="New patient" secondaryLabel="Follow-up" formatter={money}
                    />
                  </Panel>
                </div>

                <Panel title="Workflow status change events" subtitle="Recorded Booked → Completed or No-show changes by change date. An appointment can have multiple events; these are not unique patients or visit evidence.">
                  <DualBarChart rows={[
                    ...rows.map(a => ({name:a.agent,primary:a.booked_to_completed,secondary:a.booked_to_no_show})),
                    {name:'Invoice Workflow (Automated)',primary:invoiceWorkflowStatusChanges.booked_to_completed,secondary:invoiceWorkflowStatusChanges.booked_to_no_show},
                  ]} primaryLabel="Booked → Completed" secondaryLabel="Booked → No-show" />
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
                ? Math.round(((s.new_attended + s.old_attended) / s.appointments_eligible) * 1000) / 10
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
                    Lead source reflects the recorded contact channel. Revenue uses eligible acquisition evidence at or before the first clinical visit; missing or late evidence remains unattributed. Verified attendance uses the same eligible cohort and strict patient, date, physician and qualifying invoice evidence as the overview. Missing billing alone does not prove a no-show.
                  </p>
                  <p>
                    Leads, appointments and invoices use their own dates within the selected period. Revenue may appear for a source with no new lead in this period. Outbound follow-up and historical appointments are shown separately from new intake leads.
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <KPICard label="Active Sources" value={sourceRows.filter(s => s.leads > 0).length} tone="text-slate-800"
                    tooltip="Distinct lead sources with at least one lead this period." />
                  <KPICard label="Top Source" value={byLeads[0]?.source ?? '—'} tone="text-teal-600"
                    sub={byLeads[0] ? `${byLeads[0].leads} leads` : undefined}
                    tooltip="Source with the most leads this period." />
                  <KPICard label="New vs Old Leads" value={`${totalNew} / ${totalOld}`} tone="text-indigo-600"
                    sub={`${totalLeads} total · ${totalLeads - totalNew - totalOld} unknown type`}
                    tooltip="New-patient leads vs returning/Old-patient leads, across all sources this period." />
                  <KPICard label="First Clinical Day Revenue (all patients)" value={money(totalNewRevenue)} tone="text-emerald-600"
                    tooltip="Invoice revenue dated on each patient's first observed clinical day, including revenue without a known acquisition source." />
                </div>

                {(() => {
                  const ptFunnel = (sourcePerf?.patient_type_funnel || []) as { type: string; leads: number; appointments_set: number; attended: number }[]
                  const newFunnel = ptFunnel.find(p => p.type === 'New')
                  const oldFunnel = ptFunnel.find(p => p.type === 'Old')
                  if (!newFunnel && !oldFunnel) return null
                  return (
                    <Panel title="Period Activity by Patient Type" subtitle="New and Old recorded types only; unknown types are excluded here. Contact and appointment dates are independent period counts.">
                      <DualBarChart rows={[
                        { name: 'Leads', primary: newFunnel?.leads ?? 0, secondary: oldFunnel?.leads ?? 0 },
                        { name: 'Appointments Dated', primary: newFunnel?.appointments_set ?? 0, secondary: oldFunnel?.appointments_set ?? 0 },
                        { name: 'Verified Attendance', primary: newFunnel?.attended ?? 0, secondary: oldFunnel?.attended ?? 0 },
                      ]} primaryLabel="New patient" secondaryLabel="Old / returning" sortDesc={false} />
                    </Panel>
                  )
                })()}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Panel title="Lead Source Distribution" subtitle="Share of leads by source this period">
                    <DonutChart items={sourceRows.map(s => ({ label: s.source, count: s.leads }))} />
                  </Panel>
                  <Panel title="New vs Other Leads by Source" subtitle="All contacts: new patient type versus returning or unknown type.">
                    <DualBarChart
                      rows={sourceRows.map(s => ({ name: s.source, primary: s.new_leads, secondary: s.leads - s.new_leads }))}
                      primaryLabel="New patient" secondaryLabel="Other / unknown"
                    />
                  </Panel>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Panel title="Verified Attendance by Source" subtitle="Verified visits divided by eligible appointments after one full clinic-calendar day. Cancelled, rescheduled, recent and future appointments are excluded.">
                    <StatusMeterList
                      items={byAttended.map(s => ({ label: s.source, value: s.attendedRate ?? 0, sub: `${s.new_attended + s.old_attended}/${s.appointments_eligible}` }))}
                    />
                  </Panel>
                  <Panel title="Revenue by Source" subtitle="Invoice revenue by eligible acquisition source; missing or late evidence remains unattributed.">
                    <DualBarChart
                      rows={sourceRows.map(s => ({ name: s.source, primary: s.revenue_new, secondary: s.revenue_followup }))}
                      primaryLabel="First clinical day" secondaryLabel="Other invoice days" formatter={money}
                    />
                  </Panel>
                </div>

                {(() => {
                  const tta = (sourcePerf?.time_to_appointment || []) as { source: string; median_days: number; avg_days: number; n: number }[]
                  if (tta.length === 0) return null
                  return (
                    <Panel title="Time to First Appointment by Source" subtitle="Median days from contact date to first scheduled visit — fastest to slowest">
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
                  <p className="text-xs text-slate-400 mb-3">Full funnel per source — contact-date leads, visit-date appointments, and eligible MIS-verified visits. These are separate period populations.</p>
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
              <Panel title="Contact cohort to verified visit" subtitle="Distinct contacts dated in this period, followed through their linked appointments as of this report. Later cohorts have had less time to convert.">
                <FunnelChart steps={[
                  { label: 'Contacts', count: metrics.lead_cohort?.leads ?? 0, hint: 'original contact date in this period' },
                  { label: 'With appointment', count: metrics.lead_cohort?.with_appointment ?? 0, hint: 'at least one linked non-cancelled appointment' },
                  { label: 'With verified visit', count: metrics.lead_cohort?.with_verified_visit ?? 0, hint: 'at least one eligible MIS-verified completed visit' },
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
                  tooltip="Outgoing Calls queue items open when this snapshot was refreshed." />
              </Panel>
            </div>
          )}

          {tab === 'revenue' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KPICard label="CRM-attributed revenue" value={money(metrics.total_revenue)} tone="text-emerald-600" delta={d(metrics.total_revenue, 'total_revenue')}
                  tooltip="Sum of invoice revenue attributed back to a lead's source, for invoices dated in this period." />
                <KPICard label="Linked invoices" value={metrics.validation?.attributed_invoice_count ?? '—'} tooltip="Distinct valid invoices attributed to CRM leads in this invoice-date period. Duplicate or ambiguous ownership is excluded." />
              </div>
              <Panel title="Revenue populations and attribution coverage" subtitle="These totals describe different invoice populations; they are not interchangeable.">
                <div className="grid gap-3 sm:grid-cols-3">
                  <KPICard label="CRM-linked subset" value={money(metrics.total_revenue)} />
                  <KPICard label="Acquisition ledger total" value={metrics.revenue_scope ? money(metrics.revenue_scope.acquisition_ledger_total) : '—'} />
                  <KPICard label="Unattributed / historical" value={metrics.revenue_scope ? money(metrics.revenue_scope.unattributed_acquisition) : '—'} />
                </div>
                <p className="mt-3 text-xs text-slate-600">Acquisition includes reconciled invoices for patients without a CRM lead. Unattributed is a subset of that acquisition ledger, not an amount to add to CRM revenue. Channel spend and an agreed attribution window are required before calculating ROI.</p>
              </Panel>
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
              <Panel title="Appointment mix by doctor" subtitle="Scheduled appointment counts; this does not attribute invoice revenue to a physician.">
                <BarList items={(metrics.by_doctor || []).map((row: any) => ({ label: row.doctor, count: row.count }))} />
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
              <Panel title="Attendance evidence" subtitle="Strict MIS evidence and explicit clinic statuses; unavailable fields are not treated as zero">
                <div className="grid gap-3 sm:grid-cols-3"><KPICard label="MIS-verified completed visits" value={metrics.mis_verified_attended ?? '—'} /><KPICard label="Completed, awaiting MIS evidence" value={metrics.completed_appointments_without_mis_visit_proof ?? '—'} /><KPICard label="Recorded CRM no-shows" value={metrics.explicit_crm_no_shows ?? '—'} /></div>
                <p className="text-sm text-slate-600">MIS evidence requires patient, encounter date, physician, and a non-void invoice with positive billed value. This does not establish that payment was collected. No-charge care requires separate clinical evidence. Missing billing does not establish nonattendance.</p>
              </Panel>
              <Panel title="Attendance evidence coverage" subtitle="One eligible appointment population, after one complete Bangladesh calendar day for evidence to arrive.">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <KPICard label="Eligible appointments" value={metrics.attendance?.eligible ?? '—'} />
                  <KPICard label="Verified coverage" value={metrics.show_rate == null ? '—' : metrics.show_rate + '%'} tooltip="MIS-verified completed visits divided by all eligible appointments. Unresolved evidence remains in the denominator; this is evidence coverage, not a final clinical show rate." />
                  <KPICard label="Unresolved evidence" value={metrics.attendance?.unresolved ?? '—'} />
                  <KPICard label="Evidence conflicts" value={metrics.attendance?.evidence_conflicts ?? '—'} />
                </div>
                <p className="mt-3 text-xs text-slate-600">Eligible = verified + recorded no-show + unresolved. Cancelled/rescheduled: {metrics.attendance?.excluded ?? '—'}. Within grace period or future: {metrics.attendance?.awaiting_maturity ?? '—'}. Eligibility cutoff: {metrics.attendance?.eligible_through ?? '—'}. No-charge care remains unresolved until a separate clinical evidence source is available.</p>
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


            </div>
          )}
        </>
      ) : null}

      {rangeValid && !loading && !error && metrics && tab === 'ad_attribution' && (
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
function StatusMeterList({ items }: { items: { label: string; value: number; sub?: string }[] }) {
  if (!items.length) return <p className="text-sm text-slate-600">No eligible data for this period.</p>
  return <div className="space-y-3">{items.map(item => <div key={item.label}>
    <div className="flex items-center justify-between text-xs mb-1"><span>{item.label}</span><span className="tabular-nums">{item.value}% {item.sub && <span className="text-slate-600">({item.sub})</span>}</span></div>
    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full bg-teal-600" style={{ width: Math.min(100, item.value) + '%' }} /></div>
  </div>)}</div>
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
  const noShowTone = 'bg-slate-50 text-slate-700'
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
          <div className="text-[10px] text-emerald-700 font-medium">CRM revenue · New type</div>
          <div className="text-sm font-bold text-emerald-700 tabular-nums">{money(a.revenue_new)}</div>
        </div>
        <div className="bg-slate-50 rounded-lg py-2 px-1">
          <div className="text-[10px] text-slate-500 font-medium">CRM revenue · Other types</div>
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
  const noShowTone = 'bg-slate-50 text-slate-700'

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
          { name: 'Leads', primary: s.new_leads, secondary: s.leads - s.new_leads },
          { name: 'Appointments Set', primary: s.new_appointments_set, secondary: s.old_appointments_set },
          { name: 'Attended', primary: s.new_attended, secondary: s.old_attended },
        ]}
        primaryLabel="New patient" secondaryLabel="Other / unknown"
        primaryColor="bg-indigo-500" primaryText="text-indigo-700"
        sortDesc={false}
      />

      <p className="text-xs text-slate-600">{s.leads} total contacts · {s.leads - s.new_leads - s.old_leads} unknown patient type</p>
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
          <div className="text-[10px] font-medium">Recorded No-show Rate</div>
          <div className="text-sm font-bold tabular-nums">{noShowRate != null ? `${noShowRate}%` : '—'}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-100 text-center">
        <div>
          <div className="text-[10px] text-slate-400">First Clinical Day Revenue (all patients)</div>
          <div className="text-xs font-semibold text-emerald-700 tabular-nums">{money(s.revenue_new)}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">Other Invoice Days</div>
          <div className="text-xs font-semibold text-slate-600 tabular-nums">{money(s.revenue_followup)}</div>
        </div>
      </div>

    </div>
  )
}

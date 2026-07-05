'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { appointmentTypeColor } from '@/lib/appointmentTypeColors'
import { KPICard, BarList, TrendChart, Panel } from '@/components/admin/DashboardCharts'

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

const SOURCE_COLORS: Record<string, string> = {
  'Facebook': 'bg-blue-500',
  'Referral': 'bg-emerald-500',
  'Phone / Hotline': 'bg-amber-500',
  'Walk-in': 'bg-purple-500',
  'Unknown': 'bg-slate-400',
}

export default function AdminDashboardPage() {
  const router = useRouter()
  const { profile, isAdmin, loading: authLoading } = useAuth()

  useEffect(() => {
    if (!authLoading && profile && !isAdmin) router.replace('/')
  }, [authLoading, profile, isAdmin, router])

  const [rangeKey, setRangeKey] = useState<RangeKey>('month')
  const [customStart, setCustomStart] = useState(toISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [customEnd, setCustomEnd] = useState(toISO(new Date()))
  const { start, end } = useMemo(() => rangeFor(rangeKey, customStart, customEnd), [rangeKey, customStart, customEnd])

  const [metrics, setMetrics] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    setLoading(true)
    setError('')
    supabase.rpc('get_admin_dashboard_metrics', { p_start_date: start, p_end_date: end }).then(({ data, error }) => {
      if (cancelled) return
      if (error) { setError(error.message); setLoading(false); return }
      setMetrics(data)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [start, end, isAdmin])

  if (!isAdmin) return null

  const bookingRate = metrics && metrics.total_leads > 0 ? Math.round((metrics.booked_leads / metrics.total_leads) * 100) : 0

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
          <p className="text-sm text-slate-500">Call center performance, patient mix, and lead sources</p>
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
          {[0, 1, 2, 3].map(i => <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <KPICard label="Total Leads" value={metrics.total_leads} tone="text-slate-800" />
            <KPICard label="Booked" value={metrics.booked_leads} tone="text-teal-600" />
            <KPICard label="Booking Rate" value={`${bookingRate}%`} tone="text-teal-600" />
            <KPICard label="Appointments" value={metrics.total_appointments} tone="text-indigo-600" />
            <KPICard label="Attended" value={metrics.attended} tone="text-emerald-600" />
            <KPICard label="Show Rate" value={metrics.show_rate != null ? `${metrics.show_rate}%` : '—'} tone="text-emerald-600" />
            <KPICard label="No-Shows" value={metrics.no_shows} tone="text-rose-600" />
            <KPICard label="Pending Callbacks" value={metrics.pending_callbacks} tone="text-amber-600" />
          </div>

          {/* Trend */}
          <Panel title="Daily Trend" subtitle="Leads received vs appointments scheduled, per day">
            <TrendChart data={metrics.daily_trend || []} />
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Lead Source" subtitle="Facebook vs referral vs phone vs unknown">
              <BarList
                items={(metrics.by_source || []).map((s: any) => ({ label: s.source, count: s.count }))}
                colorFor={(label) => SOURCE_COLORS[label] || 'bg-slate-400'}
              />
            </Panel>

            <Panel title="New vs Returning Patients" subtitle="Based on lead intake status at time of call">
              <BarList
                items={(metrics.by_patient_type || []).map((s: any) => ({ label: s.type, count: s.count }))}
                colorFor={(label) => label === 'New' ? 'bg-teal-500' : label === 'Old' ? 'bg-indigo-500' : 'bg-slate-400'}
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

            <Panel title="Doctor Load" subtitle="Appointments booked per doctor">
              <BarList items={(metrics.by_doctor || []).map((s: any) => ({ label: s.doctor, count: s.count }))} />
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
        </>
      )}
    </div>
  )
}

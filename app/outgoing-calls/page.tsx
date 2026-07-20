'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { withRetry, parallelFetch } from '@/lib/withTimeout'
import { useVisibilityReload } from '@/hooks/useVisibilityReload'
import SummaryBar from '@/components/outgoing-calls/SummaryBar'
import QueueList from '@/components/outgoing-calls/QueueList'
import PatientDetailPanel from '@/components/outgoing-calls/PatientDetailPanel'
import OutcomePanel from '@/components/outgoing-calls/OutcomePanel'
import { CATEGORY_LABEL, QUICK_FILTERS, CALL_TYPE_LABEL, callTypeForCategory } from '@/components/outgoing-calls/types'

function todayDhaka() {
  const now = new Date()
  const dhaka = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }))
  return dhaka.toISOString().slice(0, 10)
}

export default function OutgoingCallsPage() {
  const date = todayDhaka()
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [metrics, setMetrics] = useState<any | null>(null)
  const [agent, setAgent] = useState<string>('')
  const [selected, setSelected] = useState<any | null>(null)

  const [search, setSearch] = useState('')
  const [quickFilter, setQuickFilter] = useState('all')
  const [leadTypeFilter, setLeadTypeFilter] = useState('all')
  const [callTypeFilter, setCallTypeFilter] = useState('all')
  const [agentFilter, setAgentFilter] = useState('all')
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function load() {
    setLoading(true)
    setLoadError('')

    // All three queries are independent — run them in parallel so total wait
    // is max(each), not sum(each). Each has its own timeout so a slow metrics
    // query can never freeze the loading spinner.
    const [queueRes, metricsRes, agentRes] = await parallelFetch([
      {
        work: () =>
          supabase
            .from('outgoing_call_sheet_view')
            .select('*')
            .lte('scheduled_date', date)
            .eq('attempt_status', 'pending')
            .order('category_rank')
            .order('followup_number', { ascending: true })
            .order('relevant_date', { ascending: true })
            .limit(100),
        timeoutMs: 15000,
        retries: 2,
      },
      {
        work: () => supabase.from('outgoing_call_today_metrics').select('*').single(),
        timeoutMs: 8000,
        retries: 1,
      },
      {
        work: () => supabase.rpc('get_scheduled_agent', { p_date: date }),
        timeoutMs: 8000,
        retries: 1,
      },
    ] as const)

    if (!queueRes || queueRes.error) {
      console.error('[outgoing-calls] queue load failed', queueRes?.error)
      setRows([])
      setLoadError(`Could not load the outbound queue: ${queueRes?.error?.message ?? 'Request timed out'}`)
    } else {
      setRows(queueRes.data || [])
    }
    if (metricsRes && !metricsRes.error) setMetrics(metricsRes.data)
    if (agentRes && !agentRes.error) setAgent((agentRes.data as unknown as string) || '')

    setLoading(false)
  }

  useVisibilityReload(load)

  useEffect(() => {
    load()
    const channel = supabase
      .channel('outgoing-calls')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outgoing_call_queue' }, () => {
        if (refreshTimer.current) clearTimeout(refreshTimer.current)
        refreshTimer.current = setTimeout(() => { load() }, 350)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outgoing_call_attempts' }, () => {
        if (refreshTimer.current) clearTimeout(refreshTimer.current)
        refreshTimer.current = setTimeout(() => { load() }, 350)
      })
      .subscribe()
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runPopulateNow() {
    setLoading(true)
    const { error } = await supabase.rpc('populate_outgoing_call_queue', { p_date: date })
    if (error) {
      setLoading(false)
      setLoadError(`Could not refresh the outbound queue: ${error.message}`)
      return
    }
    await load()
  }

  const agentOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.assigned_agent).filter(Boolean))
    return Array.from(set)
  }, [rows])

  const filteredRows = useMemo(() => {
    const qf = QUICK_FILTERS.find((f) => f.key === quickFilter)
    return rows.filter((r) => {
      if (search) {
        const s = search.toLowerCase()
        const hay = `${r.patient_name ?? ''} ${r.phone ?? ''} ${r.patient_id ?? ''}`.toLowerCase()
        if (!hay.includes(s)) return false
      }
      if (qf?.categories && !qf.categories.includes(r.category)) return false
      if (leadTypeFilter !== 'all' && r.category !== leadTypeFilter) return false
      if (callTypeFilter !== 'all' && callTypeForCategory(r.category) !== callTypeFilter) return false
      if (agentFilter !== 'all' && r.assigned_agent !== agentFilter) return false
      return true
    })
  }, [rows, search, quickFilter, leadTypeFilter, callTypeFilter, agentFilter])

  function handleSaved() {
    setSelected(null)
    load()
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-110px)] min-h-[970px]">
      <div className="flex-shrink-0 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Outbound Call Sheet</h1>
            <p className="text-sm text-slate-500">
              Agent-first outbound follow-up workflow · {date} · On duty:{' '}
              <span className="font-medium text-slate-700">{agent || '—'}</span>
            </p>
          </div>
          <button
            onClick={runPopulateNow}
            className="px-3 py-1.5 border border-slate-300 rounded-md text-sm text-slate-600 hover:bg-slate-50"
          >
            Refresh queue
          </button>
        </div>

        <SummaryBar metrics={metrics} />

        {loadError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {loadError} Please contact an administrator if this continues.
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-center text-sm">
          <select
            className="border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white"
            value={callTypeFilter}
            onChange={(e) => setCallTypeFilter(e.target.value)}
          >
            <option value="all">All call types</option>
            {Object.entries(CALL_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            className="border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white"
            value={leadTypeFilter}
            onChange={(e) => setLeadTypeFilter(e.target.value)}
          >
            <option value="all">All lead types</option>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            className="border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
          >
            <option value="all">All agents</option>
            {agentOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1.3fr_1fr] gap-4 flex-1 min-h-[730px]">
        <div className="min-h-0">
          <QueueList
            rows={filteredRows}
            loading={loading}
            search={search}
            onSearch={setSearch}
            quickFilter={quickFilter}
            onQuickFilter={setQuickFilter}
            selectedId={selected?.attempt_id ?? null}
            onSelect={setSelected}
          />
        </div>
        <div className="min-h-0">
          <PatientDetailPanel row={selected} />
        </div>
        <div className="min-h-0">
          <OutcomePanel row={selected} agentName={agent || 'Unknown agent'} onSaved={handleSaved} />
        </div>
      </div>

      <p className="text-xs text-slate-400 flex-shrink-0">Every call attempt is logged for executive reporting.</p>
    </div>
  )
}

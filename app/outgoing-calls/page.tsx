'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { parallelFetch } from '@/lib/withTimeout'
import SummaryBar from '@/components/outgoing-calls/SummaryBar'
import QueueList from '@/components/outgoing-calls/QueueList'
import PatientDetailPanel from '@/components/outgoing-calls/PatientDetailPanel'
import OutcomePanel from '@/components/outgoing-calls/OutcomePanel'
import { CATEGORY_LABEL, QUICK_FILTERS, CALL_TYPE_LABEL, callTypeForCategory, isProspectCategory } from '@/components/outgoing-calls/types'

function todayDhaka() {
  const now = new Date()
  const dhaka = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }))
  return dhaka.toISOString().slice(0, 10)
}

function outboundWindowKey() {
  const now = new Date()
  const dhaka = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }))
  if (dhaka.getHours() < 6) dhaka.setDate(dhaka.getDate() - 1)
  return `${dhaka.getFullYear()}-${String(dhaka.getMonth() + 1).padStart(2, '0')}-${String(dhaka.getDate()).padStart(2, '0')}`
}

function millisecondsUntilNextDhakaSix() {
  const now = new Date()
  const dhaka = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }))
  const next = new Date(dhaka)
  next.setHours(6, 0, 0, 0)
  if (dhaka >= next) next.setDate(next.getDate() + 1)
  return Math.max(1000, next.getTime() - dhaka.getTime())
}

const QUEUE_CACHE_TTL_MS = 30 * 1000

// Keep the daily sheet representative instead of allowing the
// largest low-priority bucket to consume the entire slice. Higher-priority
// rows are always selected first; the remaining slots are distributed across
// the next priority bands and then filled from the lower-priority backlog.
function selectBalancedQueue(rows: any[], limit = 250) {
  // Website appointment requests are pinned to the very top (category_rank 0,
  // pinned_to_top = true at the DB level) and are never subject to the
  // per-band quota below — every one of them must appear on the sheet.
  const pinned = rows.filter((row) => Number(row.category_rank) === 0)
  const rest = rows.filter((row) => Number(row.category_rank) !== 0)
  const restLimit = Math.max(0, limit - pinned.length)

  // Ranks: 1-3 never-visited no-shows, 4 surgery (uncapped, no dedicated
  // quota — same as before), 5-7 missed follow-ups (visited before), 8-11
  // wound, 12-15 screening, 16-19 healing/general. Each band below lists
  // only the freshest sub-rank of a multi-rank category — the older
  // sub-ranks (e.g. wound_no_appt_14/28/old) fall through to the backlog
  // fill-in below, same as before this change.
  const bands = [1, 2, 3, 5, 8, 12, 19]
  const quotas: Record<number, number> = { 1: 12, 2: 12, 3: 10, 5: 10, 8: 15, 12: 25, 19: 16 }
  const selected: any[] = []
  const remaining = [...rest]

  for (const rank of bands) {
    const matches = remaining.filter((row) => Number(row.category_rank) === rank)
    const take = Math.min(quotas[rank] || 0, matches.length, restLimit - selected.length)
    selected.push(...matches.slice(0, take))
    for (const row of matches.slice(0, take)) {
      const index = remaining.indexOf(row)
      if (index >= 0) remaining.splice(index, 1)
    }
  }

  if (selected.length < restLimit) selected.push(...remaining.slice(0, restLimit - selected.length))
  return [...pinned, ...selected].slice(0, limit)
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
  const realtimeRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadInFlight = useRef(false)
  const refreshQueued = useRef(false)
  const rowSnapshot = useRef<any[]>([])
  const metricsSnapshot = useRef<any | null>(null)
  const agentSnapshot = useRef('')
  // Version the cache whenever queue-selection rules change so agents do not
  // remain stuck on a stale daily sheet until the next 6 AM refresh.
  const cacheKey = `ekagra-outbound-sheet:v6:${outboundWindowKey()}`

  async function load(force = false) {
    if (loadInFlight.current) {
      if (force) refreshQueued.current = true
      return
    }
    loadInFlight.current = true
    setLoading(rowSnapshot.current.length === 0)
    setLoadError('')

    try {
    if (!force) {
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null')
        if (cached && cached.windowKey === outboundWindowKey() && Array.isArray(cached.rows)) {
          rowSnapshot.current = cached.rows || []
          metricsSnapshot.current = cached.metrics || null
          agentSnapshot.current = cached.agent || ''
          setRows(cached.rows || [])
          setMetrics(cached.metrics || null)
          setAgent(cached.agent || '')
          setLoading(false)
          if (Date.now() - (cached.fetchedAt || 0) < QUEUE_CACHE_TTL_MS) {
            return
          }
        }
      } catch {
        localStorage.removeItem(cacheKey)
      }
    }

    // All three queries are independent — run them in parallel so total wait
    // is max(each), not sum(each). Each has its own timeout so a slow metrics
    // query can never freeze the loading spinner.
    const [queueRes, metricsRes, agentRes] = await parallelFetch([
      {
        work: () =>
          supabase
            .from('outgoing_call_sheet_view')
            .select('attempt_id,queue_id,followup_number,scheduled_date,assigned_agent,attempt_status,outcome,outcome_code,attempt_notes,called_at,callback_at,patient_id,patient_name,phone,final_location,lead_type,category,category_rank,reason,relevant_date,queue_created_at,max_followups,followups_done,queue_status,pinned_to_top,confidence_score,confidence_label,is_overdue,doctor_service,booking_main_problem,booking_preferred_visit_date,booking_lead_status,booking_urgency,booking_notes')
            .lte('relevant_date', date)
            .eq('attempt_status', 'pending')
            // Match the view's canonical ordering and add stable tie-breakers
            // so every browser sees the same queue (especially for website
            // bookings sharing the same date and priority).
            .order('pinned_to_top', { ascending: false })
            .order('confidence_score', { ascending: false })
            .order('category_rank')
            .order('followup_number', { ascending: true })
            .order('relevant_date', { ascending: true })
            .order('queue_created_at', { ascending: true })
            .order('attempt_id', { ascending: true })
            .limit(1000),
        // PostgREST already enforces a shorter statement timeout. Do not
        // multiply load with retries when this view is slow; keep the last
        // successful sheet visible and let the agent retry explicitly.
        timeoutMs: 9000,
        retries: 0,
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
      let cachedRows: any[] = []
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null')
        if (cached && cached.windowKey === outboundWindowKey() && Array.isArray(cached.rows)) {
          cachedRows = cached.rows
          if (!rowSnapshot.current.length) {
            rowSnapshot.current = cachedRows
            metricsSnapshot.current = cached.metrics || null
            agentSnapshot.current = cached.agent || ''
            setRows(cachedRows)
            setMetrics(cached.metrics || null)
            setAgent(cached.agent || '')
          }
        }
      } catch {
        // Keep the in-memory sheet if the browser cache cannot be read.
      }
      const visibleCount = Math.max(rowSnapshot.current.length, cachedRows.length)
      setLoadError(visibleCount
        ? `Live queue refresh failed. Showing the last saved ${visibleCount} calls; retry when the connection is stable.`
        : 'Could not load the outbound queue. Retry in a moment; no calls were removed.')
    } else {
      const nextRows = selectBalancedQueue(queueRes.data || [])
      const nextMetrics = metricsRes && !metricsRes.error ? metricsRes.data : metricsSnapshot.current
      const nextAgent = agentRes && !agentRes.error ? (agentRes.data as unknown as string) || '' : agentSnapshot.current
      rowSnapshot.current = nextRows
      metricsSnapshot.current = nextMetrics
      agentSnapshot.current = nextAgent
      setRows(nextRows)
      if (nextMetrics) setMetrics(nextMetrics)
      if (agentRes && !agentRes.error) setAgent(nextAgent)
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ windowKey: outboundWindowKey(), fetchedAt: Date.now(), rows: nextRows, metrics: nextMetrics, agent: nextAgent }))
      } catch {
        // The live queue remains usable when storage is unavailable or full.
      }
    }

    } finally {
      setLoading(false)
      loadInFlight.current = false
      if (refreshQueued.current) {
        refreshQueued.current = false
        scheduleRealtimeRefresh()
      }
    }
  }

  function scheduleRealtimeRefresh() {
    if (realtimeRefreshTimer.current) clearTimeout(realtimeRefreshTimer.current)
    realtimeRefreshTimer.current = setTimeout(() => { void load(true) }, 1500)
  }

  useEffect(() => {
    load()
    const scheduleNextRefresh = () => {
      refreshTimer.current = setTimeout(async () => {
        await load(true)
        scheduleNextRefresh()
      }, millisecondsUntilNextDhakaSix())
    }
    scheduleNextRefresh()
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('outgoing-call-sheet-events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outgoing_call_queue' }, scheduleRealtimeRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outgoing_call_attempts' }, scheduleRealtimeRefresh)
      .subscribe()
    return () => {
      if (realtimeRefreshTimer.current) clearTimeout(realtimeRefreshTimer.current)
      void supabase.removeChannel(channel)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      // Prospect calls are shared intake work, not owned by the scheduled
      // recovery agent. Keep them visible in every agent's filtered list.
      if (agentFilter !== 'all' && !isProspectCategory(r.category) && r.assigned_agent !== agentFilter) return false
      return true
    })
  }, [rows, search, quickFilter, leadTypeFilter, callTypeFilter, agentFilter])

  function handleSaved() {
    const completedAttemptId = selected?.attempt_id
    if (completedAttemptId == null) return

    // The outcome RPC has already resolved this attempt in Supabase. Remove
    // it from the in-memory daily sheet immediately so the visible count drops
    // immediately without waiting for the next 6 AM refresh.
    const nextRows = rows.filter((row) => row.attempt_id !== completedAttemptId)
    rowSnapshot.current = nextRows
    setRows(nextRows)
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null')
      if (cached) localStorage.setItem(cacheKey, JSON.stringify({ ...cached, rows: nextRows }))
    } catch {
      // The live state is still updated even if localStorage is unavailable.
    }
    setSelected(null)
  }

  return (
    <div className="flex min-w-0 w-full flex-col gap-4 h-[calc(100vh-110px)] min-h-[970px]">
      <div className="flex-shrink-0 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Outbound Call Sheet</h1>
            <p className="text-sm text-slate-500">
              Agent-first outbound follow-up workflow · {date} · Recovery on duty:{' '}
              <span className="font-medium text-slate-700">{agent || '—'}</span>
              {' '}· Prospects: <span className="font-medium text-teal-700">shared queue</span>
            </p>
          </div>
        </div>

        <SummaryBar metrics={metrics} />

        {loadError && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-center justify-between gap-3">
            <span>{loadError}</span>
            <button type="button" disabled={loading} onClick={() => void load(true)} className="shrink-0 rounded border border-amber-300 bg-white px-2.5 py-1 font-medium disabled:opacity-50">
              {loading ? 'Retrying…' : 'Retry queue'}
            </button>
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

      {/* Zero-minimum tracks keep long queue text from pushing the other panels off-screen. */}
      <div className="grid min-w-0 grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)] gap-4 flex-1 min-h-[730px] [overflow-wrap:anywhere]">
        <div className="min-h-0 min-w-0">
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
        <div className="min-h-0 min-w-0">
          <PatientDetailPanel row={selected} />
        </div>
        <div className="min-h-0 min-w-0">
          <OutcomePanel row={selected} agentName={agent || 'Unknown agent'} onSaved={handleSaved} />
        </div>
      </div>

      <p className="text-xs text-slate-400 flex-shrink-0">Every call attempt is logged for executive reporting.</p>
    </div>
  )
}

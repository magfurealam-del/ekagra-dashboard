'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import SummaryBar from '@/components/outgoing-calls/SummaryBar'
import QueueList from '@/components/outgoing-calls/QueueList'
import PatientDetailPanel from '@/components/outgoing-calls/PatientDetailPanel'
import OutcomePanel from '@/components/outgoing-calls/OutcomePanel'
import { CATEGORY_LABEL, QUICK_FILTERS } from '@/components/outgoing-calls/types'

function todayDhaka() {
  const now = new Date()
  const dhaka = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }))
  return dhaka.toISOString().slice(0, 10)
}

export default function OutgoingCallsPage() {
  const date = todayDhaka()
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState<any | null>(null)
  const [agent, setAgent] = useState<string>('')
  const [selected, setSelected] = useState<any | null>(null)

  const [search, setSearch] = useState('')
  const [quickFilter, setQuickFilter] = useState('all')
  const [leadTypeFilter, setLeadTypeFilter] = useState('all')
  const [agentFilter, setAgentFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('')

  async function load() {
    setLoading(true)
    const view = statusFilter === '' ? 'outgoing_call_sheet_view' : 'outgoing_call_all_attempts_view'
    let q = supabase.from(view).select('*').order('category_rank').order('relevant_date', { ascending: false }).range(0, 9999)
    if (statusFilter === '') {
      q = q.lte('scheduled_date', date).eq('attempt_status', 'pending')
    } else if (statusFilter !== 'all') {
      q = q.eq('outcome_code', statusFilter)
    }
    const { data } = await q
    setRows(data || [])

    const { data: m } = await supabase.from('outgoing_call_today_metrics').select('*').single()
    setMetrics(m)

    const { data: agentRow } = await supabase.rpc('get_scheduled_agent', { p_date: date })
    setAgent((agentRow as unknown as string) || '')

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  async function runPopulateNow() {
    setLoading(true)
    await supabase.rpc('populate_outgoing_call_queue', { p_date: date })
    load()
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
      if (agentFilter !== 'all' && r.assigned_agent !== agentFilter) return false
      return true
    })
  }, [rows, search, quickFilter, leadTypeFilter, agentFilter])

  function handleSaved() {
    setSelected(null)
    load()
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-110px)] min-h-[560px]">
      <div className="flex-shrink-0 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Outgoing Calls</h1>
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

        <div className="flex flex-wrap gap-2 items-center text-sm">
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
          <select
            className="border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Open Queue</option>
            <option value="all">All History</option>
            <option value="reached">Reached</option>
            <option value="booked_appointment">Booked</option>
            <option value="not_interested">Not interested</option>
            <option value="call_later">Call later</option>
            <option value="do_not_call">Do not call</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1.3fr_1fr] gap-4 flex-1 min-h-0">
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

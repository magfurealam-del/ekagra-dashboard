'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

const CATEGORY_LABEL: Record<string, string> = {
  no_show: 'No-show',
  surgery_no_show: 'Surgery scheduled — no-show',
  healing_overdue: 'Not healed — 2+ weeks no visit',
  wound_screening_no_appt: 'Wound/Screening lead — no appointment',
}

const CATEGORY_COLOR: Record<string, string> = {
  no_show: 'bg-amber-100 text-amber-700',
  surgery_no_show: 'bg-rose-100 text-rose-700',
  healing_overdue: 'bg-orange-100 text-orange-700',
  wound_screening_no_appt: 'bg-sky-100 text-sky-700',
}

const OUTCOME_BUTTONS: {
  label: string
  outcome: string
  status: 'called' | 'no_answer' | 'skipped'
  resolve: boolean
  tone: string
}[] = [
  { label: 'Booked appointment', outcome: 'Booked appointment', status: 'called', resolve: true, tone: 'bg-emerald-600 hover:bg-emerald-700' },
  { label: 'Will come', outcome: 'Confirmed — will visit', status: 'called', resolve: true, tone: 'bg-emerald-500 hover:bg-emerald-600' },
  { label: 'Call back later', outcome: 'Requested callback', status: 'called', resolve: false, tone: 'bg-sky-500 hover:bg-sky-600' },
  { label: 'No answer', outcome: 'No answer', status: 'no_answer', resolve: false, tone: 'bg-slate-400 hover:bg-slate-500' },
  { label: 'Not interested', outcome: 'Not interested', status: 'called', resolve: true, tone: 'bg-slate-500 hover:bg-slate-600' },
  { label: 'Already visited elsewhere', outcome: 'Visited elsewhere', status: 'called', resolve: true, tone: 'bg-slate-500 hover:bg-slate-600' },
  { label: 'Healed / no follow-up needed', outcome: 'Healed — no follow-up needed', status: 'called', resolve: true, tone: 'bg-teal-600 hover:bg-teal-700' },
  { label: 'Wrong number', outcome: 'Wrong number', status: 'skipped', resolve: true, tone: 'bg-rose-500 hover:bg-rose-600' },
]

function todayDhaka() {
  // Server clock may not be Asia/Dhaka — compute the date string the same way the DB does.
  const now = new Date()
  const dhaka = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }))
  return dhaka.toISOString().slice(0, 10)
}

export default function OutgoingCallsPage() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [agent, setAgent] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [history, setHistory] = useState<any[]>([])
  const [notesDraft, setNotesDraft] = useState('')
  const date = todayDhaka()

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('outgoing_call_sheet_view')
      .select('*')
      .lte('scheduled_date', date)
      .eq('attempt_status', 'pending')
      .order('category_rank')
      .order('relevant_date', { ascending: false })
    setRows(data || [])
    const { data: agentRow } = await supabase.rpc('get_scheduled_agent', { p_date: date })
    setAgent((agentRow as unknown as string) || null)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function loadHistory(queueId: number) {
    const { data } = await supabase
      .from('outgoing_call_history_view')
      .select('*')
      .eq('queue_id', queueId)
      .order('followup_number')
    setHistory(data || [])
  }

  async function toggleExpand(row: any) {
    if (expanded === row.attempt_id) {
      setExpanded(null)
      return
    }
    setExpanded(row.attempt_id)
    setNotesDraft('')
    await loadHistory(row.queue_id)
  }

  async function submitOutcome(row: any, btn: (typeof OUTCOME_BUTTONS)[number]) {
    const { error } = await supabase.rpc('record_call_attempt_outcome', {
      p_attempt_id: row.attempt_id,
      p_outcome: btn.outcome,
      p_status: btn.status,
      p_notes: notesDraft || null,
      p_resolve: btn.resolve,
      p_wait_days: 3,
    })
    if (error) {
      showToast('Failed: ' + error.message)
      return
    }
    showToast(`Saved — ${btn.label}`)
    setExpanded(null)
    load()
  }

  async function runPopulateNow() {
    setLoading(true)
    const { error } = await supabase.rpc('populate_outgoing_call_queue', { p_date: date })
    if (error) showToast('Failed: ' + error.message)
    else showToast("Today's queue refreshed")
    load()
  }

  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {}
    rows.forEach((r) => {
      map[r.category] = map[r.category] || []
      map[r.category].push(r)
    })
    return map
  }, [rows])

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Outgoing Call Sheet</h1>
          <p className="text-sm text-slate-500">
            {date} · On duty today: <span className="font-medium text-slate-700">{agent ?? '—'}</span> ·{' '}
            {rows.length} pending call{rows.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          onClick={runPopulateNow}
          className="px-3 py-1.5 border border-slate-300 rounded-md text-sm text-slate-600 hover:bg-slate-50"
        >
          Refresh today's queue
        </button>
      </div>

      <p className="text-xs text-slate-400">
        Order: no-shows (most recent first) → surgery scheduled, no-show → validated patients not healed, 2+ weeks
        no visit → wound/screening leads with no appointment booked.
      </p>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-400">
          No pending calls for today.
        </div>
      ) : (
        Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} className="space-y-2">
            <h2 className="text-sm font-medium text-slate-600 flex items-center gap-2">
              <span className={`text-[10px] rounded px-1.5 py-0.5 ${CATEGORY_COLOR[cat]}`}>
                {CATEGORY_LABEL[cat] ?? cat}
              </span>
              <span className="text-slate-400">({items.length})</span>
            </h2>
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
              {items.map((r) => (
                <div key={r.attempt_id} className="p-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <div className="font-medium text-slate-800 text-sm">
                        {r.patient_name || 'Unknown'}{' '}
                        {r.is_overdue && (
                          <span className="text-[10px] rounded px-1.5 py-0.5 bg-rose-100 text-rose-700 ml-1">
                            overdue
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">{r.phone}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{r.reason}</div>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <div>
                        Followup {r.followup_number}/{r.max_followups}
                      </div>
                      <div>Agent: {r.assigned_agent}</div>
                      <button
                        onClick={() => toggleExpand(r)}
                        className="text-teal-700 hover:text-teal-800 mt-1"
                      >
                        {expanded === r.attempt_id ? 'Hide history' : 'View history'}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {OUTCOME_BUTTONS.map((btn) => (
                      <button
                        key={btn.label}
                        onClick={() => submitOutcome(r, btn)}
                        className={`text-white text-xs px-2.5 py-1.5 rounded-md ${btn.tone}`}
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>

                  {expanded === r.attempt_id && (
                    <div className="mt-3 border-t border-slate-100 pt-2 space-y-2">
                      <textarea
                        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                        placeholder="Optional note for this call…"
                        rows={2}
                        value={notesDraft}
                        onChange={(e) => setNotesDraft(e.target.value)}
                      />
                      {history.length === 0 ? (
                        <p className="text-xs text-slate-400">No previous attempts yet.</p>
                      ) : (
                        <ul className="text-xs text-slate-500 space-y-1">
                          {history.map((h) => (
                            <li key={h.attempt_id} className="flex justify-between gap-2">
                              <span>
                                #{h.followup_number} · {h.scheduled_date} · {h.assigned_agent}
                              </span>
                              <span className="text-slate-600">
                                {h.outcome || h.status} {h.notes ? `— ${h.notes}` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-sm px-4 py-3 rounded-md shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

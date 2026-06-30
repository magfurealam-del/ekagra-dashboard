'use client'

import { priorityBadges, priorityLabel } from './types'

const QUICK_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'no_show', label: 'No-show' },
  { key: 'wound', label: 'Wound' },
  { key: 'screening', label: 'Screening' },
  { key: 'followup', label: 'Follow-up' },
  { key: 'high_priority', label: 'High Priority' },
]

export default function QueueList({
  rows,
  loading,
  search,
  onSearch,
  quickFilter,
  onQuickFilter,
  selectedId,
  onSelect,
}: {
  rows: any[]
  loading: boolean
  search: string
  onSearch: (v: string) => void
  quickFilter: string
  onQuickFilter: (v: string) => void
  selectedId: number | null
  onSelect: (row: any) => void
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 flex flex-col h-full">
      <div className="p-3 border-b border-slate-100 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Priority Queue</h2>
        </div>
        <input
          className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          placeholder="Search by name, phone, or patient ID…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <div className="flex flex-wrap gap-1.5">
          {QUICK_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => onQuickFilter(f.key)}
              className={`text-xs px-2.5 py-1 rounded-md border ${
                quickFilter === f.key
                  ? 'bg-teal-600 border-teal-600 text-white'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {loading ? (
          <p className="p-4 text-sm text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">No calls match the current filters.</p>
        ) : (
          rows.map((r) => {
            const badges = priorityBadges(r)
            const active = r.attempt_id === selectedId
            return (
              <button
                key={r.attempt_id}
                onClick={() => onSelect(r)}
                className={`w-full text-left p-3 transition-colors ${
                  active ? 'bg-teal-50' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-slate-100 text-slate-600">
                      {priorityLabel(r.category_rank)}
                    </span>
                    {badges.map((b) => (
                      <span key={b.label} className={`text-[10px] rounded px-1.5 py-0.5 ${b.tone}`}>
                        {b.label}
                      </span>
                    ))}
                    {r.is_overdue && (
                      <span className="text-[10px] rounded px-1.5 py-0.5 bg-red-100 text-red-700">overdue</span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 whitespace-nowrap">
                    Attempt {r.followup_number}/{r.max_followups}
                  </span>
                </div>
                <div className="mt-1 font-medium text-sm text-slate-800">{r.patient_name || 'Unknown'}</div>
                <div className="text-xs text-slate-500">
                  {r.phone} {r.final_location ? `· ${r.final_location}` : ''}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{r.reason}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Last contact: {r.called_at ? new Date(r.called_at).toLocaleString() : 'Not contacted yet'} · Agent:{' '}
                  {r.assigned_agent}
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

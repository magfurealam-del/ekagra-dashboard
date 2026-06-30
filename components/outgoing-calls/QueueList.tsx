'use client'

import { priorityBadges, QUICK_FILTERS, formatQueueDate, daysAgoLabel } from './types'

export default function QueueList({
  rows, loading, search, onSearch, quickFilter, onQuickFilter, selectedId, onSelect,
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
    <div className="bg-white rounded-xl border border-slate-200 flex flex-col h-full min-h-0">
      {/* ── sticky header ── */}
      <div className="p-3 border-b border-slate-100 space-y-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Priority Queue</h2>
          <span className="text-xs text-slate-400">{rows.length}</span>
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
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
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

      {/* ── scrollable list ── */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
        {loading ? (
          <div className="p-4 space-y-3">
            {[0,1,2,3].map(i => (
              <div key={i} className="h-16 rounded-md bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">No calls match the current filters.</p>
        ) : (
          rows.map((r) => {
            const badges = priorityBadges(r)
            const active = r.attempt_id === selectedId
            // "Added to queue" = when the entry was created in the sheet
            const addedLabel = formatQueueDate(r.queue_created_at)
            const addedAgo   = daysAgoLabel(r.queue_created_at)
            // "First called" = relevant_date (no-show date, or lead creation date)
            const firstCalledLabel = formatQueueDate(r.relevant_date)

            return (
              <button
                key={r.attempt_id}
                onClick={() => onSelect(r)}
                className={`w-full text-left p-3 transition-colors ${
                  active ? 'bg-teal-50 border-l-2 border-l-teal-500' : 'hover:bg-slate-50'
                }`}
              >
                {/* Badge row */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-slate-100 text-slate-600">
                    P{r.category_rank}
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

                {/* Name + phone/location */}
                <div className="mt-1 font-medium text-sm text-slate-800 truncate">
                  {r.patient_name || 'Unknown'}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {r.phone}{r.final_location ? ` · ${r.final_location}` : ''}
                </div>

                {/* Dates section */}
                <div className="mt-1.5 grid grid-cols-2 gap-x-2 text-[11px]">
                  <div className="text-slate-400">
                    <span className="text-slate-500 font-medium">First called:</span>{' '}
                    {firstCalledLabel}
                  </div>
                  <div className="text-slate-400">
                    <span className="text-slate-500 font-medium">Added to sheet:</span>{' '}
                    {addedLabel}
                    {addedAgo ? <span className="text-slate-400"> ({addedAgo})</span> : null}
                  </div>
                </div>

                {/* Last contact + agent */}
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Last contact:{' '}
                  {r.called_at ? new Date(r.called_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'none'}
                  {' · '}{r.assigned_agent}
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

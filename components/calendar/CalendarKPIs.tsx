'use client'

import { appointmentTypeColor } from '@/lib/appointmentTypeColors'

export type TypeTotal = { type: string; count: number }

// Dashboard cards for appointment types — only types with a non-zero count
// for the visible month are rendered, so the row shrinks/grows automatically
// as the mix of bookings changes.
export default function CalendarKPIs({ typeTotals }: { typeTotals: TypeTotal[] }) {
  const nonZero = typeTotals.filter(t => t.count > 0).sort((a, b) => b.count - a.count)

  if (nonZero.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-3 text-sm text-slate-400">
        No appointments scheduled this month yet.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {nonZero.map(t => {
        const color = appointmentTypeColor(t.type)
        return (
          <div key={t.type} className="bg-white rounded-xl border border-slate-200 p-3">
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
              <span className="truncate">{t.type}</span>
            </div>
            <div className={`text-2xl font-bold mt-1 ${color.tone}`}>{t.count}</div>
          </div>
        )
      })}
    </div>
  )
}

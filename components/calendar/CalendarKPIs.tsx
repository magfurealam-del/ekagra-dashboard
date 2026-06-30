'use client'

const KPI_CARDS = [
  { key: 'total_patients',        label: "Tomorrow's Patients",     icon: '👥', tone: 'text-slate-800' },
  { key: 'night_before_confirmed',label: 'Night-Before Confirmed',  icon: '✅', tone: 'text-emerald-600' },
  { key: 'morning_confirmed',     label: 'Morning Confirmed',       icon: '🌅', tone: 'text-teal-600' },
  { key: 'pending_calls',         label: 'Pending Calls',           icon: '📞', tone: 'text-amber-600' },
  { key: 'no_show_risk',          label: 'No-Show Risk',            icon: '⚠️', tone: 'text-rose-600' },
  { key: 'doctors_scheduled',     label: 'Doctors Scheduled',       icon: '👨‍⚕️', tone: 'text-indigo-600' },
]

export default function CalendarKPIs({ kpi }: { kpi: any | null }) {
  const total = kpi?.total_patients || 0
  return (
    <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
      {KPI_CARDS.map((c) => {
        const val = kpi?.[c.key] ?? '—'
        const pct = c.key === 'night_before_confirmed' && total > 0 ? `${Math.round((val/total)*100)}%` : null
        return (
          <div key={c.key} className="bg-white rounded-xl border border-slate-200 p-3">
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <span>{c.icon}</span> {c.label}
            </div>
            <div className={`text-2xl font-bold mt-1 ${c.tone}`}>{val}</div>
            {pct && <div className="text-xs text-slate-400">{pct}</div>}
          </div>
        )
      })}
    </div>
  )
}

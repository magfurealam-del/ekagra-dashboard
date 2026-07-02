'use client'

export default function SummaryBar({ metrics }: { metrics: any | null }) {
  const cards = [
    { label: 'Completed Today', value: metrics?.completed_today ?? '—', tone: 'text-emerald-600' },
    { label: 'Reached', value: metrics?.reached ?? '—', tone: 'text-indigo-600' },
    { label: 'Booked', value: metrics?.booked ?? '—', tone: 'text-teal-600' },
    { label: 'Overdue Callbacks', value: metrics?.overdue_callbacks ?? '—', tone: 'text-rose-600' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-xs text-slate-500">{c.label}</div>
          <div className={`text-2xl font-semibold ${c.tone}`}>{c.value}</div>
        </div>
      ))}
    </div>
  )
}

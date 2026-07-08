'use client'

export default function SummaryBar({ metrics }: { metrics: any | null }) {
  const topCards = [
    { label: 'Pending', value: metrics?.pending_calls ?? '—', tone: 'text-amber-600' },
    { label: 'Completed Today', value: metrics?.completed_today ?? '—', tone: 'text-emerald-600' },
    { label: 'Overdue Callbacks', value: metrics?.overdue_callbacks ?? '—', tone: 'text-rose-600' },
  ]

  // Live count for every one-click outcome option, in the same order and
  // color scheme as the Call Outcome panel — so agents can see at a glance
  // how today's calls are breaking down without leaving this page.
  const outcomeCards = [
    { label: 'Reached', value: metrics?.reached ?? 0, tone: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
    { label: 'Not Reached', value: metrics?.not_reached ?? 0, tone: 'border-slate-300 bg-slate-50 text-slate-600' },
    { label: 'Busy', value: metrics?.busy ?? 0, tone: 'border-amber-300 bg-amber-50 text-amber-700' },
    { label: 'Switched Off', value: metrics?.switched_off ?? 0, tone: 'border-slate-300 bg-slate-50 text-slate-600' },
    { label: 'Wrong Number', value: metrics?.wrong_number ?? 0, tone: 'border-rose-300 bg-rose-50 text-rose-700' },
    { label: 'Booked Appointment', value: metrics?.booked ?? 0, tone: 'border-teal-400 bg-teal-50 text-teal-700' },
    { label: 'Already Visited', value: metrics?.already_visited ?? 0, tone: 'border-slate-300 bg-slate-50 text-slate-600' },
    { label: 'Not Interested', value: metrics?.not_interested ?? 0, tone: 'border-slate-300 bg-slate-50 text-slate-600' },
    { label: 'Call Later', value: metrics?.call_later ?? 0, tone: 'border-sky-300 bg-sky-50 text-sky-700' },
    { label: 'Do Not Call', value: metrics?.do_not_call ?? 0, tone: 'border-rose-300 bg-rose-50 text-rose-700' },
  ]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {topCards.map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-slate-200 p-3">
            <div className="text-xs text-slate-500">{c.label}</div>
            <div className={`text-2xl font-semibold ${c.tone}`}>{c.value}</div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <div className="text-xs text-slate-500 mb-2">Today&apos;s outcomes (live)</div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {outcomeCards.map((c) => (
            <div key={c.label} className={`rounded-md border px-2.5 py-2 ${c.tone}`}>
              <div className="text-lg font-bold leading-none">{c.value}</div>
              <div className="text-[11px] font-medium mt-0.5">{c.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

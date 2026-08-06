'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { withRetry } from '@/lib/withTimeout'

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function toIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Inline month calendar for jumping to any date on the Doctor Availability
 * page. Dots any date that already has at least one doctor marked
 * unavailable, so front desk can spot upcoming gaps at a glance instead of
 * clicking through every day.
 */
export default function AvailabilityCalendar({
  value,
  onChange,
}: {
  value: string // yyyy-mm-dd
  onChange: (iso: string) => void
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const base = value ? new Date(value + 'T00:00:00') : new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })
  const [unavailableCounts, setUnavailableCounts] = useState<Record<string, number>>({})

  // Keep the visible month in sync when the selected date changes from
  // outside this component (e.g. the "Tomorrow" shortcut). Adjusting state
  // during render (rather than in an effect) avoids the extra render pass -
  // see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [lastValue, setLastValue] = useState(value)
  if (value && value !== lastValue) {
    setLastValue(value)
    const d = new Date(value + 'T00:00:00')
    if (d.getFullYear() !== viewMonth.getFullYear() || d.getMonth() !== viewMonth.getMonth()) {
      setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1))
    }
  }

  useEffect(() => {
    let cancelled = false
    const start = toIso(viewMonth)
    const end = toIso(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0))
    withRetry(
      () => supabase
        .from('doctor_daily_availability')
        .select('avail_date, is_available')
        .eq('is_available', false)
        .gte('avail_date', start)
        .lte('avail_date', end),
      12000, 2,
    ).then(({ data }) => {
      if (cancelled) return
      const counts: Record<string, number> = {}
      ;(data || []).forEach((r: { avail_date: string; is_available: boolean }) => { counts[r.avail_date] = (counts[r.avail_date] || 0) + 1 })
      setUnavailableCounts(counts)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [viewMonth])

  const todayIso = toIso(new Date())

  const weeks = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
    const startPad = first.getDay()
    const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate()
    const cells: (Date | null)[] = Array(startPad).fill(null)
    for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day))
    while (cells.length % 7 !== 0) cells.push(null)
    const rows: (Date | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
    return rows
  }, [viewMonth])

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 w-full max-w-xs">
      <div className="flex items-center justify-between px-1 pb-2">
        <button
          type="button"
          className="px-2 py-1 text-slate-500 hover:text-slate-800"
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
        >
          ‹
        </button>
        <span className="font-medium text-sm text-slate-700">{MONTH_LABEL.format(viewMonth)}</span>
        <button
          type="button"
          className="px-2 py-1 text-slate-500 hover:text-slate-800"
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-slate-400 mb-1">
        {WEEKDAY_LABELS.map((w) => <div key={w}>{w}</div>)}
      </div>
      {weeks.map((row, i) => (
        <div key={i} className="grid grid-cols-7 text-center">
          {row.map((d, j) => {
            if (!d) return <div key={j} className="py-1" />
            const iso = toIso(d)
            const selected = iso === value
            const isToday = iso === todayIso
            const unavailable = unavailableCounts[iso] || 0
            return (
              <button
                key={j}
                type="button"
                onClick={() => onChange(iso)}
                title={unavailable ? `${unavailable} doctor${unavailable > 1 ? 's' : ''} marked unavailable` : undefined}
                className={`relative m-0.5 rounded-md py-1.5 text-xs ${
                  selected
                    ? 'bg-teal-600 text-white'
                    : isToday
                      ? 'bg-teal-50 text-teal-700 font-medium'
                      : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {d.getDate()}
                {unavailable > 0 && (
                  <span className={`absolute top-0.5 right-1 h-1.5 w-1.5 rounded-full ${selected ? 'bg-white' : 'bg-rose-500'}`} />
                )}
              </button>
            )
          })}
        </div>
      ))}
      <div className="flex items-center gap-1.5 pt-2 mt-1 border-t border-slate-100 text-[10px] text-slate-400">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Has doctor(s) marked unavailable
      </div>
    </div>
  )
}

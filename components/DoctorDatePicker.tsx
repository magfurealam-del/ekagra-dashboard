'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { withRetry } from '@/lib/withTimeout'

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function toIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Blacks out dates the doctor doesn't work, so agents can't pick a date that
// will only surface "No slots configured" after the fact in the time field.
export default function DoctorDatePicker({
  doctorName,
  value,
  onChange,
}: {
  doctorName: string
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => {
    const base = value ? new Date(value + 'T00:00:00') : new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  const [activeDays, setActiveDays] = useState<Set<number>>(new Set())
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map())

  useEffect(() => {
    if (!doctorName) { setActiveDays(new Set()); return }
    withRetry(
      () => supabase.from('doctor_schedules').select('day_of_week').eq('doctor_name', doctorName).eq('is_active', true),
      12000, 2,
    ).then(({ data }) => {
      setActiveDays(new Set((data || []).map((d: any) => d.day_of_week)))
    }).catch(() => {})
  }, [doctorName])

  useEffect(() => {
    if (!doctorName) { setOverrides(new Map()); return }
    const start = toIso(viewMonth)
    const end = toIso(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0))
    withRetry(
      () => supabase.from('doctor_daily_availability').select('avail_date, is_available')
        .eq('doctor_name', doctorName).gte('avail_date', start).lte('avail_date', end),
      12000, 2,
    ).then(({ data }) => {
      setOverrides(new Map((data || []).map((d: any) => [d.avail_date, d.is_available])))
    }).catch(() => {})
  }, [doctorName, viewMonth])

  function isDisabled(d: Date) {
    const iso = toIso(d)
    if (overrides.has(iso)) return !overrides.get(iso)
    return !activeDays.has(d.getDay())
  }

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

  const displayLabel = value
    ? new Date(value + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : ''

  return (
    <div className="relative">
      <input
        readOnly
        className="input cursor-pointer"
        placeholder="Select..."
        value={displayLabel}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-30 mt-1 w-72 rounded-md border border-slate-200 bg-white shadow-lg p-2 text-sm">
          <div className="flex items-center justify-between px-1 pb-2">
            <button
              type="button"
              className="px-2 py-1 text-slate-500 hover:text-slate-800"
              onMouseDown={(e) => { e.preventDefault(); setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1)) }}
            >
              ‹
            </button>
            <span className="font-medium text-slate-700">{MONTH_LABEL.format(viewMonth)}</span>
            <button
              type="button"
              className="px-2 py-1 text-slate-500 hover:text-slate-800"
              onMouseDown={(e) => { e.preventDefault(); setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1)) }}
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs text-slate-400 mb-1">
            {WEEKDAY_LABELS.map((w) => <div key={w}>{w}</div>)}
          </div>
          {weeks.map((row, i) => (
            <div key={i} className="grid grid-cols-7 text-center">
              {row.map((d, j) => {
                if (!d) return <div key={j} />
                const iso = toIso(d)
                const disabled = !doctorName || isDisabled(d)
                const selected = iso === value
                return (
                  <button
                    key={j}
                    type="button"
                    disabled={disabled}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      onChange(iso)
                      setOpen(false)
                    }}
                    className={`m-0.5 rounded-md py-1 text-xs ${
                      disabled
                        ? 'text-slate-300 cursor-not-allowed'
                        : selected
                          ? 'bg-teal-600 text-white'
                          : 'text-slate-700 hover:bg-teal-50'
                    }`}
                  >
                    {d.getDate()}
                  </button>
                )
              })}
            </div>
          ))}
          {!doctorName && <p className="text-xs text-slate-400 px-1 pt-1">Pick a doctor first to see available dates.</p>}
        </div>
      )}
    </div>
  )
}

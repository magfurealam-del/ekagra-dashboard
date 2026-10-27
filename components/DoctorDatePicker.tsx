'use client'
import { useMemo, useState } from 'react'
import { useDoctorBooking } from '@/hooks/useDoctorBooking'
import { clinicDate } from '@/lib/dashboard-presentation'

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
    const base = new Date((value || clinicDate()) + 'T00:00:00')
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  const monthStart=toIso(viewMonth), monthEnd=toIso(new Date(viewMonth.getFullYear(),viewMonth.getMonth()+1,0))
  const availability=useDoctorBooking(doctorName,monthStart,monthEnd)
  function isDisabled(d: Date) { return !availability.data?.days.find(day=>day.date===toIso(d))?.slots.length }

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
        onClick={() => {if(!open)availability.refresh();setOpen((o) => !o)}}
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
          {availability.loading && <p className="text-xs p-1">Loading available dates…</p>}
          {availability.error && <button type="button" className="text-xs text-rose-700 underline" onMouseDown={e=>{e.preventDefault();availability.refresh()}}>Retry available dates</button>}
          {availability.data?.status !== 'ready' && doctorName && <p className="text-xs p-1 text-amber-700">{availability.note}</p>}
          {!doctorName && <p className="text-xs text-slate-400 px-1 pt-1">Pick a doctor first to see available dates.</p>}
        </div>
      )}
    </div>
  )
}

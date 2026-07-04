'use client'

import { appointmentTypeColor } from '@/lib/appointmentTypeColors'

export type DayPill = { key: string; label: string; className: string; count?: number }
export type TypeCount = { type: string; count: number }
export type DayCellData = { pills: DayPill[]; total: number; doctors?: string[]; typeCounts?: TypeCount[] }

function monthMatrix(year: number, month: number) {
  const first = new Date(year, month, 1)
  const startDay = first.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = Array(startDay).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function isToday(year: number, month: number, d: number) {
  const t = new Date()
  return t.getFullYear() === year && t.getMonth() === month && t.getDate() === d
}

export default function CalendarGrid({
  year, month, dayData, selectedDate, onDayClick, onPrev, onNext, compact,
}: {
  year: number
  month: number
  dayData: Record<string, DayCellData>
  selectedDate: string | null
  onDayClick: (dateStr: string) => void
  onPrev: () => void
  onNext: () => void
  compact?: boolean
}) {
  const cells = monthMatrix(year, month)
  const monthLabel = new Date(year, month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className={`bg-white rounded-xl border border-slate-200 h-full flex flex-col ${compact ? 'p-2' : 'p-4'}`}>
      <div className={`flex items-center justify-between ${compact ? 'mb-2' : 'mb-4'}`}>
        <button onClick={onPrev} className="px-3 py-1 border rounded-md text-sm hover:bg-slate-50">← Prev</button>
        <h2 className="font-semibold text-slate-800">{monthLabel}</h2>
        <button onClick={onNext} className="px-3 py-1 border rounded-md text-sm hover:bg-slate-50">Next →</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs text-slate-400 mb-1">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} className="text-center py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5 flex-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />
          const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
          const cell = dayData[dateStr]
          const today = isToday(year, month, d)
          const selected = selectedDate === dateStr
          const clickable = !!cell && cell.total > 0

          return (
            <button
              key={i}
              onClick={() => clickable && onDayClick(dateStr)}
              disabled={!clickable}
              className={`border rounded-lg overflow-hidden transition-all text-xs ${compact ? 'p-1 min-h-[36px]' : 'p-2 min-h-[120px] text-left'} ${
                selected ? 'border-teal-500 ring-2 ring-teal-300 bg-teal-50'
                : today ? 'border-teal-400 bg-teal-50'
                : 'border-slate-200 hover:border-slate-300'
              } ${clickable ? 'cursor-pointer' : 'cursor-default opacity-60'}`}
            >
              <div className="flex items-center justify-between">
                <span className={`font-medium text-xs ${today ? 'text-teal-700' : 'text-slate-500'}`}>{d}</span>
                {cell && (
                  <span className="font-bold text-slate-800 text-sm leading-none">{cell.total}</span>
                )}
              </div>
              {cell && cell.typeCounts && cell.typeCounts.length > 0 && (
                <div className={`flex gap-0.5 flex-wrap ${compact ? 'mt-0.5' : 'mt-1'}`}>
                  {cell.typeCounts.map(tc => (
                    <span
                      key={tc.type}
                      title={`${tc.type}: ${tc.count}`}
                      className={`rounded-full ${appointmentTypeColor(tc.type).dot} ${compact ? 'w-1.5 h-1.5' : 'w-2 h-2'}`}
                    />
                  ))}
                </div>
              )}
              {cell && !compact && (
                <>
                  <div className="mt-1.5 space-y-0.5">
                    {cell.pills.map(p => (
                      <div key={p.key} className={`text-[9px] rounded px-1 ${p.className} leading-tight truncate`}>
                        {p.count != null ? `${p.label}: ${p.count}` : p.label}
                      </div>
                    ))}
                  </div>
                  {cell.doctors && cell.doctors.length > 0 && (
                    <div className="mt-1 text-[9px] text-slate-400 leading-tight truncate">
                      {cell.doctors.slice(0,2).map((d:string) => d.replace('Dr. ','')).join(', ')}
                      {cell.doctors.length > 2 ? ` +${cell.doctors.length-2}` : ''}
                    </div>
                  )}
                </>
              )}
            </button>
          )
        })}
      </div>
      {!compact && (
        <div className="flex flex-wrap gap-3 mt-3 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-200"/>Confirmed</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-200"/>Pending</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-200"/>No-show Risk</span>
        </div>
      )}
    </div>
  )
}

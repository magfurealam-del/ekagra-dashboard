'use client'

export type DayPill = { key: string; label: string; className: string; count?: number }
export type DayCellData = { pills: DayPill[]; total: number }

function monthMatrix(year: number, month: number) {
  const first = new Date(year, month, 1)
  const startDay = first.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = Array(startDay).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export default function CalendarGrid({
  year,
  month,
  dayData,
  selectedDate,
  onDayClick,
  onPrev,
  onNext,
}: {
  year: number
  month: number
  dayData: Record<string, DayCellData>
  selectedDate: string | null
  onDayClick: (dateStr: string) => void
  onPrev: () => void
  onNext: () => void
}) {
  const cells = monthMatrix(year, month)
  const monthLabel = new Date(year, month, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <button onClick={onPrev} className="px-3 py-1 border rounded-md text-sm">
          ← Prev
        </button>
        <h2 className="font-medium">{monthLabel}</h2>
        <button onClick={onNext} className="px-3 py-1 border rounded-md text-sm">
          Next →
        </button>
      </div>
      <div className="grid grid-cols-7 gap-2 text-xs text-slate-400 mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          const cell = dayData[dateStr]
          const clickable = !!cell && cell.total > 0
          return (
            <button
              key={i}
              onClick={() => clickable && onDayClick(dateStr)}
              disabled={!clickable}
              className={`border rounded-md p-2 text-left min-h-[80px] transition-colors ${
                selectedDate === dateStr
                  ? 'border-teal-500 ring-1 ring-teal-400'
                  : 'border-slate-200'
              } ${clickable ? 'hover:border-teal-400 cursor-pointer' : 'cursor-default'}`}
            >
              <div className="text-xs font-medium">{d}</div>
              {cell && cell.pills.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {cell.pills.map((p) => (
                    <div key={p.key} className={`text-[10px] rounded px-1 ${p.className}`}>
                      {p.count != null ? `${p.label}: ${p.count}` : p.label}
                    </div>
                  ))}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

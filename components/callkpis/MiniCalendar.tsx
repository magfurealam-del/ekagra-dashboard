'use client'

function toISO(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function MiniCalendar({
  month, onMonthChange, selectedDate, onSelectDate, countsByDate,
}: {
  month: Date
  onMonthChange: (d: Date) => void
  selectedDate: string | null
  onSelectDate: (date: string) => void
  countsByDate: Record<string, number>
}) {
  const year = month.getFullYear()
  const m = month.getMonth()
  const firstOfMonth = new Date(year, m, 1)
  const startWeekday = firstOfMonth.getDay()
  const daysInMonth = new Date(year, m + 1, 0).getDate()
  const todayIso = toISO(new Date())

  const cells: (number | null)[] = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 w-64 flex-shrink-0">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => onMonthChange(new Date(year, m - 1, 1))}
          className="text-xs px-1.5 py-0.5 rounded hover:bg-slate-100 text-slate-500"
        >
          ←
        </button>
        <span className="text-xs font-medium text-slate-700">
          {month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <button
          onClick={() => onMonthChange(new Date(year, m + 1, 1))}
          className="text-xs px-1.5 py-0.5 rounded hover:bg-slate-100 text-slate-500"
        >
          →
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="text-[10px] text-slate-400 font-medium py-1">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />
          const iso = toISO(new Date(year, m, day))
          const count = countsByDate[iso]
          const isSelected = selectedDate === iso
          const isToday = iso === todayIso
          return (
            <button
              key={i}
              onClick={() => onSelectDate(iso)}
              className={`relative text-xs rounded-md py-1.5 transition-colors ${
                isSelected ? 'bg-teal-600 text-white' : isToday ? 'bg-teal-50 text-teal-700 font-medium' : 'hover:bg-slate-100 text-slate-600'
              }`}
            >
              {day}
              {count != null && count > 0 && (
                <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-teal-500'}`} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

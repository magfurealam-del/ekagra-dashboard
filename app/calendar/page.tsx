'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

function monthMatrix(year: number, month: number) {
  const first = new Date(year, month, 1)
  const startDay = first.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = Array(startDay).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

const COLORS: Record<string, string> = {
  booked_count: 'bg-slate-100 text-slate-700',
  confirmed_count: 'bg-emerald-100 text-emerald-700',
  completed_count: 'bg-emerald-100 text-emerald-700',
  no_show_count: 'bg-amber-100 text-amber-700',
  rescheduled_count: 'bg-sky-100 text-sky-700',
  cancelled_count: 'bg-slate-200 text-slate-500',
}

export default function CalendarPage() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [summary, setSummary] = useState<Record<string, any>>({})
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [dayAppts, setDayAppts] = useState<any[]>([])

  async function load() {
    const start = new Date(year, month, 1).toISOString().slice(0, 10)
    const end = new Date(year, month + 1, 0).toISOString().slice(0, 10)
    const { data } = await supabase
      .from('calendar_summary_view')
      .select('*')
      .gte('appointment_date', start)
      .lte('appointment_date', end)
    const map: Record<string, any> = {}
    ;(data || []).forEach((row: any) => { map[row.appointment_date] = row })
    setSummary(map)
  }

  useEffect(() => { load() }, [year, month]) // eslint-disable-line react-hooks/exhaustive-deps

  async function openDay(dateStr: string) {
    setSelectedDate(dateStr)
    const { data } = await supabase.from('today_appointments_view').select('*').eq('appointment_date', dateStr)
    setDayAppts(data || [])
  }

  const cells = monthMatrix(year, month)
  const monthLabel = new Date(year, month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-4 pb-20">
      <h1 className="text-2xl font-semibold">Calendar</h1>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => { const m = month - 1; if (m < 0) { setMonth(11); setYear(year - 1) } else setMonth(m) }} className="px-3 py-1 border rounded-md text-sm">← Prev</button>
          <h2 className="font-medium">{monthLabel}</h2>
          <button onClick={() => { const m = month + 1; if (m > 11) { setMonth(0); setYear(year + 1) } else setMonth(m) }} className="px-3 py-1 border rounded-md text-sm">Next →</button>
        </div>
        <div className="grid grid-cols-7 gap-2 text-xs text-slate-400 mb-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="text-center">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {cells.map((d, i) => {
            if (d === null) return <div key={i} />
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            const s = summary[dateStr]
            return (
              <button key={i} onClick={() => openDay(dateStr)} className="border border-slate-200 rounded-md p-2 text-left hover:border-teal-400 min-h-[80px]">
                <div className="text-xs font-medium">{d}</div>
                {s && (
                  <div className="mt-1 space-y-0.5">
                    {['booked_count','confirmed_count','completed_count','no_show_count','rescheduled_count','cancelled_count'].map((k) =>
                      s[k] > 0 ? (
                        <div key={k} className={`text-[10px] rounded px-1 ${COLORS[k]}`}>
                          {k.replace('_count','').replace('_',' ')}: {s[k]}
                        </div>
                      ) : null
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {selectedDate && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
          <h3 className="font-medium">{selectedDate}</h3>
          {dayAppts.length === 0 ? <p className="text-sm text-slate-400">No appointments.</p> : (
            <ul className="text-sm divide-y divide-slate-100">
              {dayAppts.map((a) => (
                <li key={a.appointment_id} className="py-2 flex justify-between">
                  <span>{a.appointment_time} · {a.patient_name} · {a.doctor_service}</span>
                  <span className="text-xs text-slate-500">{a.appointment_status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

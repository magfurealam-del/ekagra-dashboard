'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import CalendarGrid, { DayCellData, DayPill } from '@/components/calendar/CalendarGrid'
import ConfirmationCallSheet from '@/components/calendar/ConfirmationCallSheet'

export default function CalendarPage() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const [daySummaryRows, setDaySummaryRows] = useState<any[]>([])
  const [loadingGrid, setLoadingGrid] = useState(true)

  // Doctor/patient filter
  const [doctorFilter, setDoctorFilter] = useState<string>('all')
  const [allDoctors, setAllDoctors] = useState<string[]>([])

  const start = useMemo(() => new Date(year, month, 1).toISOString().slice(0, 10), [year, month])
  const end   = useMemo(() => new Date(year, month + 1, 0).toISOString().slice(0, 10), [year, month])

  // Load day summaries from the new calendar_day_summary view
  useEffect(() => {
    let cancelled = false
    setLoadingGrid(true)
    supabase
      .from('calendar_day_summary')
      .select('*')
      .gte('appointment_date', start)
      .lte('appointment_date', end)
      .then(({ data }) => {
        if (cancelled) return
        setDaySummaryRows(data || [])
        // Collect distinct doctors for filter
        const docs = new Set<string>()
        ;(data || []).forEach((r: any) => (r.doctors_list || []).forEach((d: string) => docs.add(d)))
        setAllDoctors(Array.from(docs).sort())
        setLoadingGrid(false)
      })
    return () => { cancelled = true }
  }, [start, end])

  function changeMonth(delta: number) {
    let m = month + delta, y = year
    if (m < 0)  { m = 11; y -= 1 }
    if (m > 11) { m = 0;  y += 1 }
    setMonth(m); setYear(y); setSelectedDate(null)
  }

  // Build day cells
  const dayData: Record<string, DayCellData> = useMemo(() => {
    const map: Record<string, DayCellData> = {}
    daySummaryRows.forEach((row: any) => {
      const pills: DayPill[] = []
      if (row.confirmed_count > 0)
        pills.push({ key: 'confirmed', label: '✓', className: 'bg-emerald-100 text-emerald-700', count: row.confirmed_count })
      if (row.pending_count > 0)
        pills.push({ key: 'pending', label: '⏳', className: 'bg-amber-100 text-amber-700', count: row.pending_count })
      if (row.no_show_risk_count > 0)
        pills.push({ key: 'risk', label: '⚠', className: 'bg-rose-100 text-rose-700', count: row.no_show_risk_count })
      map[row.appointment_date] = {
        pills,
        total: row.total_count,
        doctors: row.doctors_list || [],
      }
    })
    return map
  }, [daySummaryRows])

  const sheetOpen = !!selectedDate

  return (
    <div className="space-y-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Calendar</h1>
          <p className="text-sm text-slate-500">Appointment control center</p>
        </div>
        <div className="flex items-center gap-2">
          {allDoctors.length > 0 && (
            <select
              value={doctorFilter}
              onChange={e => setDoctorFilter(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
            >
              <option value="all">All doctors</option>
              {allDoctors.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Main content — calendar left, call sheet right when a date is selected */}
      <div className={`grid gap-4 ${sheetOpen ? 'grid-cols-1 xl:grid-cols-[1fr_2.2fr]' : 'grid-cols-1'}`}>
        {/* Calendar grid */}
        <div className="lg:h-[calc(100vh-160px)] min-h-[600px]">
          <CalendarGrid
            year={year}
            month={month}
            dayData={dayData}
            selectedDate={selectedDate}
            onDayClick={setSelectedDate}
            onPrev={() => changeMonth(-1)}
            onNext={() => changeMonth(1)}
          />
        </div>

        {/* Confirmation call sheet — opens inline on the right */}
        {sheetOpen && (
          <div className="lg:h-[calc(100vh-160px)] min-h-[600px]">
            <ConfirmationCallSheet
              date={selectedDate!}
              onClose={() => setSelectedDate(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import CalendarGrid, { DayCellData, DayPill, TypeCount } from '@/components/calendar/CalendarGrid'
import CalendarKPIs, { TypeTotal } from '@/components/calendar/CalendarKPIs'
import ConfirmationCallSheet from '@/components/calendar/ConfirmationCallSheet'

export default function CalendarPage() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string | null>(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  )

  const [daySummaryRows, setDaySummaryRows] = useState<any[]>([])
  const [typeSummaryRows, setTypeSummaryRows] = useState<any[]>([])
  const [loadingGrid, setLoadingGrid] = useState(true)

  // Doctor/patient filter
  const [doctorFilter, setDoctorFilter] = useState<string>('all')
  const [allDoctors, setAllDoctors] = useState<string[]>([])

  const start = useMemo(() => new Date(year, month, 1).toISOString().slice(0, 10), [year, month])
  const end   = useMemo(() => new Date(year, month + 1, 0).toISOString().slice(0, 10), [year, month])

  async function loadCalendarData() {
    const [{ data: summary }, { data: types }] = await Promise.all([
      supabase.from('calendar_day_summary').select('*').gte('appointment_date', start).lte('appointment_date', end),
      supabase.from('calendar_day_type_summary').select('*').gte('appointment_date', start).lte('appointment_date', end),
    ])
    setDaySummaryRows(summary || [])
    setTypeSummaryRows(types || [])
    const docs = new Set<string>()
    ;(summary || []).forEach((r: any) => (r.doctors_list || []).forEach((d: string) => docs.add(d)))
    setAllDoctors(Array.from(docs).sort())
    return summary
  }

  // Load day summaries + per-appointment-type counts from Supabase views
  useEffect(() => {
    let cancelled = false
    setLoadingGrid(true)
    loadCalendarData().then(() => { if (!cancelled) setLoadingGrid(false) })
    return () => { cancelled = true }
  }, [start, end])

  // Live-sync the month grid with changes made from Lead Intake, another
  // browser tab, or the appointment panel below (new bookings, reschedules,
  // status/patient edits) instead of only refreshing on direct clicks here.
  useEffect(() => {
    const channel = supabase
      .channel('calendar-grid')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_appointments' }, () => { loadCalendarData() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [start, end])

  function changeMonth(delta: number) {
    let m = month + delta, y = year
    if (m < 0)  { m = 11; y -= 1 }
    if (m > 11) { m = 0;  y += 1 }
    setMonth(m); setYear(y); setSelectedDate(null)
  }

  // Per-day appointment-type breakdown, keyed by date
  const typeCountsByDate: Record<string, TypeCount[]> = useMemo(() => {
    const map: Record<string, TypeCount[]> = {}
    typeSummaryRows.forEach((row: any) => {
      const list = map[row.appointment_date] || (map[row.appointment_date] = [])
      list.push({ type: row.appt_type, count: row.cnt })
    })
    return map
  }, [typeSummaryRows])

  // Month-wide totals per appointment type, feeding the dashboard cards below
  const monthTypeTotals: TypeTotal[] = useMemo(() => {
    const totals: Record<string, number> = {}
    typeSummaryRows.forEach((row: any) => {
      totals[row.appt_type] = (totals[row.appt_type] || 0) + row.cnt
    })
    return Object.entries(totals).map(([type, count]) => ({ type, count }))
  }, [typeSummaryRows])

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
        typeCounts: typeCountsByDate[row.appointment_date] || [],
      }
    })
    return map
  }, [daySummaryRows, typeCountsByDate])

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

      {/* Appointment-type dashboard — cards appear only for types with bookings this month */}
      {!sheetOpen && <CalendarKPIs typeTotals={monthTypeTotals} />}

      {/* Main content — calendar on top, appointment panel below when a date is selected */}
      <div className={sheetOpen ? 'flex flex-col gap-4' : ''}>
        {/* Calendar grid */}
        <div className={sheetOpen ? 'h-[360px]' : 'lg:h-[calc(100vh-160px)] min-h-[600px]'}>
          <CalendarGrid
            year={year}
            month={month}
            dayData={dayData}
            selectedDate={selectedDate}
            onDayClick={setSelectedDate}
            onPrev={() => changeMonth(-1)}
            onNext={() => changeMonth(1)}
            compact={sheetOpen}
          />
        </div>

        {/* Appointment / confirmation call panel — full width below the calendar */}
        {sheetOpen && (
          <div className="min-h-[600px]">
            <ConfirmationCallSheet
              date={selectedDate!}
              doctorFilter={doctorFilter}
              onClose={() => setSelectedDate(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { withRetry } from '@/lib/withTimeout'
import CalendarGrid, { DayCellData, DayPill, TypeCount } from '@/components/calendar/CalendarGrid'
import CalendarKPIs, { TypeTotal } from '@/components/calendar/CalendarKPIs'
import ConfirmationCallSheet from '@/components/calendar/ConfirmationCallSheet'
import AppointmentStatusChanges from '@/components/calendar/AppointmentStatusChanges'
import { SchedulingInsights } from '@/components/calendar/SchedulingInsights'
import { clinicDate } from '@/lib/dashboard-presentation'
import {useBookingDoctors} from '@/hooks/useDoctorBooking'
import {canonicalBookingName} from '@/lib/doctor-schedule'

const calendarCache: { key: string; data: any[]; fetchedAt: number } = { key: '', data: [], fetchedAt: 0 }
const CALENDAR_TTL_MS = 30 * 60 * 1000

// Build date-only query bounds from local calendar parts. Using toISOString()
// here shifts Dhaka midnight into the previous UTC day and drops month-end
// appointments (for example, August 31).
function localDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function CalendarPage() {
  // The server and remote users must select the same clinic calendar day.
  const today = clinicDate()
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [month, setMonth] = useState(Number(today.slice(5, 7)) - 1)
  const [selectedDate, setSelectedDate] = useState<string | null>(today)

  // Raw appointment rows for the visible month — filtering by doctor happens
  // entirely client-side (useMemo below) so switching doctors is instant and
  // actually updates the grid, instead of only ever affecting the day panel.
  const [monthRows, setMonthRows] = useState<any[]>([])
  const {doctors:directory}=useBookingDoctors(true)
  const canonicalRows=useMemo(()=>monthRows.map(r=>({...r,doctor_service:canonicalBookingName(r.doctor_service||'',directory)})),[monthRows,directory])
  const [loadingGrid, setLoadingGrid] = useState(true)
  const [loadError, setLoadError] = useState('')

  // Doctor/patient filter
  const [doctorFilter, setDoctorFilter] = useState<string>('all')
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const start = useMemo(() => localDateString(new Date(year, month, 1)), [year, month])
  const end   = useMemo(() => localDateString(new Date(year, month + 1, 0)), [year, month])

  async function loadCalendarData(force = false) {
    const cacheKey = `${start}|${end}`
    if (!force && calendarCache.key === cacheKey && Date.now() - calendarCache.fetchedAt < CALENDAR_TTL_MS) {
      return calendarCache.data
    }
    try {
      const { data, error } = await withRetry(() => supabase
        .from('crm_appointments')
        .select('appointment_date, appointment_time, doctor_service, appointment_type, appointment_status, confirmation_status, no_show_risk')
        .gte('appointment_date', start)
        .lte('appointment_date', end)
        .neq('appointment_status', 'Cancelled'), 15000, 2)
      if (error) throw error
      calendarCache.key = cacheKey
      calendarCache.data = data || []
      calendarCache.fetchedAt = Date.now()
      return data || []
    } catch (error) {
      console.error('[calendar] load failed', error)
      return null
    }
  }


  // Load the month's appointments once; doctor filtering is applied client-side
  useEffect(() => {
    let cancelled = false
    setLoadingGrid(true)
    setLoadError('')
    loadCalendarData().then(data => {
      if (cancelled) return
      setMonthRows(data || [])
      setLoadError(data === null ? 'Appointment data could not be loaded. Reload the page to retry; empty days are not confirmed availability.' : '')
      setLoadingGrid(false)
    })
    return () => { cancelled = true }
  }, [start, end])

  // All doctors seen this month — always derived from the unfiltered set so
  // the dropdown doesn't shrink to just the currently-selected doctor.
  const allDoctors = useMemo(() => {
    const docs = new Set<string>()
    canonicalRows.forEach((r: any) => { if (r.doctor_service) docs.add(r.doctor_service) })
    return Array.from(docs).sort()
  }, [canonicalRows])

  // The set the grid/dashboard actually render from — reacts to doctorFilter
  const filteredRows = useMemo(
    () => (doctorFilter === 'all' ? canonicalRows : canonicalRows.filter((r: any) => r.doctor_service === doctorFilter)),
    [canonicalRows, doctorFilter]
  )

  function changeMonth(delta: number) {
    let m = month + delta, y = year
    if (m < 0)  { m = 11; y -= 1 }
    if (m > 11) { m = 0;  y += 1 }
    setMonth(m); setYear(y); setSelectedDate(null)
  }

  // Per-day appointment-type breakdown, keyed by date — reacts to doctorFilter
  const typeCountsByDate: Record<string, TypeCount[]> = useMemo(() => {
    const perDate: Record<string, Record<string, number>> = {}
    filteredRows.forEach((r: any) => {
      const type = r.appointment_type || 'Unspecified'
      const byType = perDate[r.appointment_date] || (perDate[r.appointment_date] = {})
      byType[type] = (byType[type] || 0) + 1
    })
    const map: Record<string, TypeCount[]> = {}
    Object.entries(perDate).forEach(([date, counts]) => {
      map[date] = Object.entries(counts).map(([type, count]) => ({ type, count }))
    })
    return map
  }, [filteredRows])

  // Month-wide totals per appointment type, feeding the dashboard cards below
  const monthTypeTotals: TypeTotal[] = useMemo(() => {
    const totals: Record<string, number> = {}
    filteredRows.forEach((r: any) => {
      const type = r.appointment_type || 'Unspecified'
      totals[type] = (totals[type] || 0) + 1
    })
    return Object.entries(totals).map(([type, count]) => ({ type, count }))
  }, [filteredRows])

  // Build day cells — reacts to doctorFilter via filteredRows
  const dayData: Record<string, DayCellData> = useMemo(() => {
    const perDate: Record<string, any[]> = {}
    filteredRows.forEach((r: any) => {
      ;(perDate[r.appointment_date] || (perDate[r.appointment_date] = [])).push(r)
    })
    const map: Record<string, DayCellData> = {}
    Object.entries(perDate).forEach(([date, dayRows]) => {
      const confirmedCount = dayRows.filter(r => r.confirmation_status === 'Confirmed' || r.confirmation_status === 'confirmed').length
      const pendingCount = dayRows.filter(r =>
        r.confirmation_status !== 'Confirmed' && r.confirmation_status !== 'confirmed' &&
        r.appointment_status !== 'Cancelled' && r.appointment_status !== 'Rescheduled'
      ).length
      const riskCount = dayRows.filter(r => r.no_show_risk === 'high').length
      const doctors = Array.from(new Set(dayRows.map(r => r.doctor_service).filter(Boolean))).sort()

      const pills: DayPill[] = []
      if (confirmedCount > 0) pills.push({ key: 'confirmed', label: '✓', className: 'bg-emerald-100 text-emerald-700', count: confirmedCount })
      if (pendingCount > 0)   pills.push({ key: 'pending', label: '⏳', className: 'bg-amber-100 text-amber-700', count: pendingCount })
      if (riskCount > 0)      pills.push({ key: 'risk', label: '⚠', className: 'bg-rose-100 text-rose-700', count: riskCount })

      map[date] = {
        pills,
        total: dayRows.length,
        doctors,
        typeCounts: typeCountsByDate[date] || [],
      }
    })
    return map
  }, [filteredRows, typeCountsByDate])

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
              aria-label="Calendar doctor or service"
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

      {loadError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{loadError}</p>}
      {!loadingGrid && !loadError && <SchedulingInsights rows={filteredRows} />}
      {/* Appointment-type dashboard — cards appear only for types with bookings this month */}
      {!sheetOpen && !loadingGrid && !loadError && <CalendarKPIs typeTotals={monthTypeTotals} />}

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

      {/* Status change audit log — always visible below the calendar */}
      <AppointmentStatusChanges key={selectedDate || 'no-date'} date={selectedDate} />
    </div>
  )
}

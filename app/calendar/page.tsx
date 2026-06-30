'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ViewModeTabs, { ViewMode } from '@/components/calendar/ViewModeTabs'
import PersonSearch from '@/components/calendar/PersonSearch'
import CalendarGrid, { DayCellData, DayPill } from '@/components/calendar/CalendarGrid'
import DayDrawer from '@/components/calendar/DayDrawer'
import PatientSummaryBar from '@/components/calendar/PatientSummaryBar'

const AGGREGATE_KEYS = [
  'booked_count',
  'confirmed_count',
  'completed_count',
  'no_show_count',
  'rescheduled_count',
  'cancelled_count',
] as const

const AGGREGATE_COLORS: Record<string, string> = {
  booked_count: 'bg-slate-100 text-slate-700',
  confirmed_count: 'bg-emerald-100 text-emerald-700',
  completed_count: 'bg-emerald-100 text-emerald-700',
  no_show_count: 'bg-amber-100 text-amber-700',
  rescheduled_count: 'bg-sky-100 text-sky-700',
  cancelled_count: 'bg-slate-200 text-slate-500',
}

const DOCTOR_COLORS: Record<string, string> = {
  completed_count: 'bg-emerald-100 text-emerald-700',
  no_show_count: 'bg-amber-100 text-amber-700',
  pending_count: 'bg-sky-100 text-sky-700',
}

const STATUS_PILL_COLOR: Record<string, string> = {
  Completed: 'bg-emerald-100 text-emerald-700',
  'No-show': 'bg-amber-100 text-amber-700',
  Pending: 'bg-sky-100 text-sky-700',
  Cancelled: 'bg-slate-200 text-slate-500',
  Rescheduled: 'bg-slate-200 text-slate-500',
}

export default function CalendarPage() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const [viewMode, setViewMode] = useState<ViewMode>('aggregate')
  const [selectedPersonId, setSelectedPersonId] = useState<string | number | null>(null)
  const [selectedPersonLabel, setSelectedPersonLabel] = useState<string | null>(null)
  const [patientSummary, setPatientSummary] = useState<any | null>(null)

  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const [aggregateRows, setAggregateRows] = useState<any[]>([])
  const [patientRows, setPatientRows] = useState<any[]>([])
  const [doctorRows, setDoctorRows] = useState<any[]>([])

  const start = useMemo(() => new Date(year, month, 1).toISOString().slice(0, 10), [year, month])
  const end = useMemo(() => new Date(year, month + 1, 0).toISOString().slice(0, 10), [year, month])

  // Aggregate data — used as-is for 'aggregate' mode, and as the whole-month view for
  // 'patient'/'doctor' mode before a specific person is selected.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('calendar_summary_view')
      .select('*')
      .gte('appointment_date', start)
      .lte('appointment_date', end)
      .then(({ data }) => {
        if (!cancelled) setAggregateRows(data || [])
      })
    return () => {
      cancelled = true
    }
  }, [start, end])

  // Patient mode, person selected: per-visit rows + patient summary header.
  useEffect(() => {
    if (viewMode !== 'patient' || selectedPersonId == null) {
      setPatientRows([])
      setPatientSummary(null)
      return
    }
    let cancelled = false
    supabase
      .from('day_detail_appointments_view')
      .select('*')
      .eq('patient_id', selectedPersonId)
      .gte('appointment_date', start)
      .lte('appointment_date', end)
      .then(({ data }) => {
        if (!cancelled) setPatientRows(data || [])
      })
    supabase
      .from('patient_visit_summary')
      .select('*')
      .eq('patient_id', selectedPersonId)
      .single()
      .then(({ data }) => {
        if (!cancelled) setPatientSummary(data || null)
      })
    return () => {
      cancelled = true
    }
  }, [viewMode, selectedPersonId, start, end])

  // Doctor mode, doctor selected: per-day counts for that doctor only.
  useEffect(() => {
    if (viewMode !== 'doctor' || selectedPersonId == null) {
      setDoctorRows([])
      return
    }
    let cancelled = false
    supabase
      .from('doctor_visit_summary')
      .select('*')
      .eq('doctor_service', selectedPersonId)
      .gte('appointment_date', start)
      .lte('appointment_date', end)
      .then(({ data }) => {
        if (!cancelled) setDoctorRows(data || [])
      })
    return () => {
      cancelled = true
    }
  }, [viewMode, selectedPersonId, start, end])

  function handleViewModeChange(v: ViewMode) {
    setViewMode(v)
    setSelectedPersonId(null)
    setSelectedPersonLabel(null)
    setSelectedDate(null)
  }

  function handlePersonSelect(id: string | number, label: string) {
    setSelectedPersonId(id)
    setSelectedPersonLabel(label)
    setSelectedDate(null)
  }

  function handlePersonClear() {
    setSelectedPersonId(null)
    setSelectedPersonLabel(null)
    setSelectedDate(null)
  }

  function changeMonth(delta: number) {
    let m = month + delta
    let y = year
    if (m < 0) {
      m = 11
      y -= 1
    } else if (m > 11) {
      m = 0
      y += 1
    }
    setMonth(m)
    setYear(y)
    setSelectedDate(null)
  }

  // Build the per-date cell data the dumb CalendarGrid renders, based on active mode.
  const dayData: Record<string, DayCellData> = useMemo(() => {
    const map: Record<string, DayCellData> = {}

    if (viewMode === 'aggregate' || (viewMode !== 'patient' && selectedPersonId == null)) {
      // aggregate mode, or doctor/patient mode with nobody selected yet
      aggregateRows.forEach((row: any) => {
        const pills: DayPill[] = AGGREGATE_KEYS.filter((k) => row[k] > 0).map((k) => ({
          key: k,
          label: k.replace('_count', '').replace('_', ' '),
          className: AGGREGATE_COLORS[k],
          count: row[k],
        })) as any
        map[row.appointment_date] = { pills, total: row.total_count ?? 0 }
      })
      return map
    }

    if (viewMode === 'patient' && selectedPersonId != null) {
      patientRows.forEach((row: any) => {
        const status = row.validated_status as string
        const existing = map[row.appointment_date]
        const pill: DayPill = {
          key: status,
          label: status,
          className: STATUS_PILL_COLOR[status] ?? 'bg-slate-100 text-slate-600',
        } as any
        if (existing) {
          existing.pills.push(pill)
          existing.total += 1
        } else {
          map[row.appointment_date] = { pills: [pill], total: 1 }
        }
      })
      return map
    }

    if (viewMode === 'doctor' && selectedPersonId != null) {
      doctorRows.forEach((row: any) => {
        const pills: DayPill[] = ['completed_count', 'no_show_count', 'pending_count']
          .filter((k) => row[k] > 0)
          .map((k) => ({
            key: k,
            label: k.replace('_count', '').replace('_', ' '),
            className: DOCTOR_COLORS[k],
            count: row[k],
          })) as any
        map[row.appointment_date] = { pills, total: row.total_count ?? 0 }
      })
      return map
    }

    return map
  }, [viewMode, selectedPersonId, aggregateRows, patientRows, doctorRows])

  const drawerFilter =
    viewMode === 'patient' && selectedPersonId != null
      ? { patientId: selectedPersonId }
      : viewMode === 'doctor' && selectedPersonId != null
      ? { doctorService: String(selectedPersonId) }
      : undefined

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <div className="flex items-center gap-3">
          <ViewModeTabs value={viewMode} onChange={handleViewModeChange} />
          <PersonSearch
            viewMode={viewMode}
            selectedLabel={selectedPersonLabel}
            onSelect={handlePersonSelect}
            onClear={handlePersonClear}
          />
        </div>
      </div>

      {viewMode === 'patient' && selectedPersonId != null && (
        <PatientSummaryBar summary={patientSummary} />
      )}

      <CalendarGrid
        year={year}
        month={month}
        dayData={dayData}
        selectedDate={selectedDate}
        onDayClick={setSelectedDate}
        onPrev={() => changeMonth(-1)}
        onNext={() => changeMonth(1)}
      />

      {selectedDate && (
        <DayDrawer date={selectedDate} filter={drawerFilter} onClose={() => setSelectedDate(null)} />
      )}
    </div>
  )
}

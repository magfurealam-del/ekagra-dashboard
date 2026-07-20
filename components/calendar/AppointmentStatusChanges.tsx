'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { withRetry } from '@/lib/withTimeout'
import { useVisibilityReload } from '@/hooks/useVisibilityReload'

type StatusChange = {
  id: number
  appointment_id: number
  appointment_date: string
  appointment_time: string | null
  doctor_service: string | null
  patient_name: string | null
  field_changed: string
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_at: string
}

const FIELD_LABEL: Record<string, string> = {
  appointment_status: 'Appointment Status',
  confirmation_status: 'Confirmation',
  night_before_status: 'Night Before',
  morning_of_status: 'Morning Of',
}

const STATUS_BADGE: Record<string, string> = {
  'Confirmed':        'bg-emerald-100 text-emerald-700',
  'confirmed':        'bg-emerald-100 text-emerald-700',
  'Booked':           'bg-teal-100 text-teal-700',
  'Attended':         'bg-indigo-100 text-indigo-700',
  'No-show':          'bg-rose-100 text-rose-700',
  'Cancelled':        'bg-slate-200 text-slate-600',
  'Rescheduled':      'bg-amber-100 text-amber-700',
  'Not Reached':      'bg-slate-200 text-slate-600',
  'Busy':             'bg-amber-100 text-amber-700',
  'Wants Reschedule': 'bg-purple-100 text-purple-700',
  'Switched Off':     'bg-slate-200 text-slate-600',
  'Wrong Number':     'bg-rose-100 text-rose-700',
}

function StatusBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-400 text-xs italic">—</span>
  return (
    <span className={`text-xs rounded-full px-2 py-0.5 whitespace-nowrap ${STATUS_BADGE[value] ?? 'bg-slate-100 text-slate-600'}`}>
      {value}
    </span>
  )
}

function timingLabel(changedAt: string, apptDate: string, apptTime: string | null): { label: string; tone: string } {
  const changed = new Date(changedAt)
  const appt = new Date(`${apptDate}T${apptTime ?? '00:00'}:00`)
  const diffMin = Math.round((changed.getTime() - appt.getTime()) / 60000)

  if (diffMin < -120) {
    const hrs = Math.round(-diffMin / 60)
    return { label: `${hrs}h before appt`, tone: 'text-slate-400' }
  }
  if (diffMin < 0) {
    return { label: `${-diffMin}m before appt`, tone: 'text-amber-600' }
  }
  if (diffMin < 60) {
    return { label: `${diffMin}m after appt`, tone: 'text-rose-500' }
  }
  const hrs = Math.round(diffMin / 60)
  return { label: `${hrs}h after appt`, tone: 'text-rose-400' }
}

export default function AppointmentStatusChanges({ start, end }: { start: string; end: string }) {
  const [rows, setRows] = useState<StatusChange[]>([])
  const [loading, setLoading] = useState(true)
  const [fieldFilter, setFieldFilter] = useState('all')
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function load() {
    setLoading(true)
    try {
      const { data } = await withRetry(
        () => supabase
          .from('appointment_status_changes')
          .select(`
            id, appointment_id, appointment_date, appointment_time,
            doctor_service, field_changed, old_value, new_value, changed_by, changed_at,
            patients ( full_name )
          `)
          .gte('appointment_date', start)
          .lte('appointment_date', end)
          .order('changed_at', { ascending: false })
          .limit(300),
        12000,
        2,
      )
      setRows(
        (data || []).map((r: any) => ({
          ...r,
          patient_name: r.patients?.full_name ?? null,
        }))
      )
    } catch (err) {
      console.error('[appt-status-changes] load failed', err)
    }
    setLoading(false)
  }

  useVisibilityReload(load)

  useEffect(() => {
    load()
    const channel = supabase
      .channel('appt-status-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'appointment_status_changes' }, () => {
        if (refreshTimer.current) clearTimeout(refreshTimer.current)
        refreshTimer.current = setTimeout(load, 500)
      })
      .subscribe()
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      supabase.removeChannel(channel)
    }
  }, [start, end])

  const filtered = fieldFilter === 'all' ? rows : rows.filter(r => r.field_changed === fieldFilter)

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Status Change Log</h2>
          <p className="text-xs text-slate-400 mt-0.5">Every status update this month — who changed what, and when relative to the appointment</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {Object.entries(FIELD_LABEL).map(([k, v]) => (
            <button
              key={k}
              onClick={() => setFieldFilter(fieldFilter === k ? 'all' : k)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                fieldFilter === k
                  ? 'bg-teal-600 border-teal-600 text-white'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {v}
            </button>
          ))}
          {fieldFilter !== 'all' && (
            <button onClick={() => setFieldFilter('all')} className="text-xs text-slate-400 hover:text-slate-600">
              Clear
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-400 py-4 text-center">No status changes recorded this month yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-xs text-slate-400 uppercase border-b border-slate-100">
                <th className="text-left py-2 pr-4 font-medium">Changed at</th>
                <th className="text-left py-2 pr-4 font-medium">Appointment</th>
                <th className="text-left py-2 pr-4 font-medium">vs Appt time</th>
                <th className="text-left py-2 pr-4 font-medium">Doctor / Service</th>
                <th className="text-left py-2 pr-4 font-medium">Patient</th>
                <th className="text-left py-2 pr-4 font-medium">Field</th>
                <th className="text-left py-2 pr-4 font-medium">From</th>
                <th className="text-left py-2 pr-4 font-medium">To</th>
                <th className="text-left py-2 font-medium">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(r => {
                const timing = r.appointment_time
                  ? timingLabel(r.changed_at, r.appointment_date, r.appointment_time)
                  : null
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2 pr-4 whitespace-nowrap text-slate-600 text-xs">
                      {new Date(r.changed_at).toLocaleString('en-GB', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap text-slate-700 text-xs">
                      {new Date(r.appointment_date + 'T00:00:00').toLocaleDateString('en-GB', {
                        day: '2-digit', month: 'short',
                      })}
                      {r.appointment_time && (
                        <span className="text-slate-400 ml-1">· {r.appointment_time}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap text-xs">
                      {timing
                        ? <span className={timing.tone}>{timing.label}</span>
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    <td className="py-2 pr-4 text-slate-600 text-xs max-w-[140px] truncate">
                      {r.doctor_service || '—'}
                    </td>
                    <td className="py-2 pr-4 text-slate-700 text-xs max-w-[130px] truncate">
                      {r.patient_name || '—'}
                    </td>
                    <td className="py-2 pr-4">
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                        {FIELD_LABEL[r.field_changed] ?? r.field_changed}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge value={r.old_value} />
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge value={r.new_value} />
                    </td>
                    <td className="py-2 text-xs text-slate-500 whitespace-nowrap">
                      {r.changed_by || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-xs text-slate-400 mt-2">Showing {filtered.length} change{filtered.length !== 1 ? 's' : ''} · Tracking starts from today</p>
        </div>
      )}
    </div>
  )
}

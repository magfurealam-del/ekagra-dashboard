'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// The clinic has no doctors on duty Friday (day_of_week 5) at all, so
// "tomorrow" on a Thursday should skip straight to Saturday rather than
// showing a day with nothing to mark — there's nothing for front desk to
// manage on a day no one is scheduled.
function tomorrowDhaka() {
  const now = new Date()
  const dhaka = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }))
  dhaka.setDate(dhaka.getDate() + 1)
  if (dhaka.getDay() === 5) dhaka.setDate(dhaka.getDate() + 1)
  return dhaka
}

function toISO(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

function fmtTime(t: string | null) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

type ScheduleRow = { doctor_name: string; start_time: string; end_time: string }
type OverrideRow = {
  doctor_name: string
  is_available: boolean
  start_time: string | null
  end_time: string | null
  note: string | null
  updated_by: string | null
  updated_at: string | null
}

export default function DoctorAvailabilityPage() {
  const date = tomorrowDhaka()
  const dateIso = toISO(date)
  const dow = date.getDay()

  const [schedule, setSchedule] = useState<ScheduleRow[]>([])
  const [overrides, setOverrides] = useState<Record<string, OverrideRow>>({})
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  async function load() {
    setLoading(true)
    const { data: sched } = await supabase
      .from('doctor_schedules')
      .select('doctor_name, start_time, end_time')
      .eq('day_of_week', dow)
      .eq('is_active', true)
      .order('doctor_name')
    setSchedule(sched || [])

    const { data: ov } = await supabase
      .from('doctor_daily_availability')
      .select('doctor_name, is_available, start_time, end_time, note, updated_by, updated_at')
      .eq('avail_date', dateIso)
    const map: Record<string, OverrideRow> = {}
    ;(ov || []).forEach(r => { map[r.doctor_name] = r as OverrideRow })
    setOverrides(map)
    setLoading(false)
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('doctor-daily-availability')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'doctor_daily_availability' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateIso])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  async function toggleAvailable(doctorName: string, nextAvailable: boolean) {
    const { error } = await supabase.rpc('set_doctor_daily_availability', {
      p_doctor_name: doctorName,
      p_avail_date: dateIso,
      p_is_available: nextAvailable,
      p_start_time: null,
      p_end_time: null,
      p_note: overrides[doctorName]?.note || null,
    })
    if (error) { showToast('Error: ' + error.message); return }
    showToast(nextAvailable ? 'Marked available.' : 'Marked unavailable.')
  }

  async function saveHours(doctorName: string, startTime: string, endTime: string) {
    const { error } = await supabase.rpc('set_doctor_daily_availability', {
      p_doctor_name: doctorName,
      p_avail_date: dateIso,
      p_is_available: true,
      p_start_time: startTime || null,
      p_end_time: endTime || null,
      p_note: overrides[doctorName]?.note || null,
    })
    if (error) { showToast('Error: ' + error.message); return }
    showToast('Hours updated.')
  }

  async function saveNote(doctorName: string, note: string) {
    const existing = overrides[doctorName]
    const { error } = await supabase.rpc('set_doctor_daily_availability', {
      p_doctor_name: doctorName,
      p_avail_date: dateIso,
      p_is_available: existing?.is_available ?? true,
      p_start_time: existing?.start_time || null,
      p_end_time: existing?.end_time || null,
      p_note: note || null,
    })
    if (error) { showToast('Error: ' + error.message); return }
  }

  async function resetToNormal(doctorName: string) {
    const { error } = await supabase.rpc('clear_doctor_daily_availability', {
      p_doctor_name: doctorName,
      p_avail_date: dateIso,
    })
    if (error) { showToast('Error: ' + error.message); return }
    showToast('Reset to normal schedule.')
  }

  const formattedDate = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div className="space-y-4 pb-20">
      <div>
        <h1 className="text-2xl font-semibold">Doctor Availability</h1>
        <p className="text-sm text-slate-500">
          {DAY_NAMES[dow]}&apos;s normal doctors — <span className="font-medium text-slate-700">{formattedDate}</span>
        </p>
        <p className="text-xs text-slate-400 mt-1">
          Mark any doctor unavailable or with reduced hours for tomorrow. Changes take effect immediately across the Calendar and new-booking screens.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
      ) : schedule.length === 0 ? (
        <p className="text-sm text-slate-400">No doctors have {DAY_NAMES[dow]} hours in their normal schedule.</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {schedule.map(s => (
            <DoctorRow
              key={s.doctor_name}
              doctorName={s.doctor_name}
              normalStart={s.start_time}
              normalEnd={s.end_time}
              override={overrides[s.doctor_name] || null}
              onToggle={(next) => toggleAvailable(s.doctor_name, next)}
              onSaveHours={(start, end) => saveHours(s.doctor_name, start, end)}
              onSaveNote={(note) => saveNote(s.doctor_name, note)}
              onReset={() => resetToNormal(s.doctor_name)}
            />
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 bg-slate-900 text-white text-xs px-3 py-2 rounded-md shadow-lg z-20">
          {toast}
        </div>
      )}
    </div>
  )
}

function DoctorRow({
  doctorName, normalStart, normalEnd, override, onToggle, onSaveHours, onSaveNote, onReset,
}: {
  doctorName: string
  normalStart: string
  normalEnd: string
  override: OverrideRow | null
  onToggle: (next: boolean) => void
  onSaveHours: (start: string, end: string) => void
  onSaveNote: (note: string) => void
  onReset: () => void
}) {
  const isOverridden = !!override
  const isAvailable = override ? override.is_available : true
  const [start, setStart] = useState(override?.start_time?.slice(0, 5) || normalStart.slice(0, 5))
  const [end, setEnd] = useState(override?.end_time?.slice(0, 5) || normalEnd.slice(0, 5))
  const [note, setNote] = useState(override?.note || '')
  const hasCustomHours = isAvailable && !!override?.start_time

  return (
    <div className="p-3 flex flex-wrap items-center gap-3">
      <div className="min-w-[220px] flex-1">
        <div className="font-medium text-sm text-slate-800">{doctorName}</div>
        <div className="text-xs text-slate-400">
          Normal hours: {fmtTime(normalStart)} – {fmtTime(normalEnd)}
        </div>
        {isOverridden && (
          <div className="text-[11px] text-sky-600 mt-0.5">
            {isAvailable
              ? hasCustomHours ? `Custom hours tomorrow: ${fmtTime(override!.start_time)} – ${fmtTime(override!.end_time)}` : 'Confirmed — normal hours'
              : 'Marked unavailable tomorrow'}
            {override?.updated_by ? ` · by ${override.updated_by}` : ''}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onToggle(true)}
          className={`text-xs px-2.5 py-1.5 rounded-md transition-colors ${isAvailable ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          Available
        </button>
        <button
          onClick={() => onToggle(false)}
          className={`text-xs px-2.5 py-1.5 rounded-md transition-colors ${!isAvailable ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          Unavailable
        </button>
      </div>

      {isAvailable && (
        <div className="flex items-center gap-1 text-xs">
          <input type="time" className="input py-1 text-xs w-24" value={start} onChange={e => setStart(e.target.value)} />
          <span className="text-slate-400">to</span>
          <input type="time" className="input py-1 text-xs w-24" value={end} onChange={e => setEnd(e.target.value)} />
          <button
            onClick={() => onSaveHours(start, end)}
            className="text-xs px-2 py-1 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50"
            title="Save custom hours for tomorrow only"
          >
            Save hours
          </button>
        </div>
      )}

      <input
        className="input py-1 text-xs w-40"
        placeholder="Note (optional)"
        value={note}
        onChange={e => setNote(e.target.value)}
        onBlur={() => note !== (override?.note || '') && onSaveNote(note)}
      />

      {isOverridden && (
        <button
          onClick={onReset}
          className="text-xs px-2 py-1 rounded-md border border-slate-300 text-slate-400 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-600"
          title="Clear override and return to normal schedule"
        >
          Reset
        </button>
      )}
    </div>
  )
}

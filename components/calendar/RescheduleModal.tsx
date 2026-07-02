'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function RescheduleModal({
  appointment, onClose, onDone,
}: {
  appointment: { appointment_id: number; patient_name?: string; appointment_date?: string; appointment_time?: string; doctor_service?: string }
  onClose: () => void
  onDone: () => void
}) {
  const [newDate, setNewDate] = useState(appointment.appointment_date || '')
  const [slots, setSlots] = useState<string[]>([])
  const [newTime, setNewTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!newDate || !appointment.doctor_service) { setSlots([]); return }
    supabase
      .from('doctor_schedules')
      .select('*')
      .eq('doctor_name', appointment.doctor_service)
      .eq('is_active', true)
      .then(({ data }) => {
        const dow = new Date(newDate + 'T00:00:00').getDay()
        const day = (data || []).find((s: any) => s.day_of_week === dow)
        if (!day) { setSlots([]); return }
        const [sh, sm] = day.start_time.slice(0, 5).split(':').map(Number)
        const [eh, em] = day.end_time.slice(0, 5).split(':').map(Number)
        const step = day.slot_minutes || 15
        const list: string[] = []
        let mins = sh * 60 + sm
        const endMins = eh * 60 + em
        while (mins < endMins) {
          const h = Math.floor(mins / 60)
          const m = mins % 60
          list.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
          mins += step
        }
        setSlots(list)
      })
  }, [newDate, appointment.doctor_service])

  function formatSlot(t: string) {
    const [h, m] = t.split(':').map(Number)
    const ampm = h >= 12 ? 'pm' : 'am'
    let h12 = h % 12
    if (h12 === 0) h12 = 12
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
  }

  async function submit() {
    if (!newDate || !newTime) { setError('Pick a new date and time.'); return }
    setSaving(true)
    setError('')
    const { error: rpcError } = await supabase.rpc('reschedule_appointment', {
      old_appointment_id: appointment.appointment_id,
      new_date: newDate,
      new_time: newTime,
    })
    setSaving(false)
    if (rpcError) { setError(rpcError.message); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="font-semibold text-slate-800">Reschedule appointment</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {appointment.patient_name || 'Patient'} · currently {appointment.appointment_date} {appointment.appointment_time}
          </p>
        </div>

        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">New date</span>
          <input type="date" className="input w-full" value={newDate} onChange={(e) => { setNewDate(e.target.value); setNewTime('') }} />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">New time</span>
          <select className="input w-full" value={newTime} onChange={(e) => setNewTime(e.target.value)} disabled={slots.length === 0}>
            <option value="">Select…</option>
            {slots.map((s) => <option key={s} value={s}>{formatSlot(s)}</option>)}
          </select>
          {newDate && slots.length === 0 && (
            <span className="text-xs text-rose-600 mt-1 block">No slots configured for this doctor on this day — check Settings.</span>
          )}
        </label>

        {error && <p className="text-xs text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 border border-slate-300 rounded-md text-sm text-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-3 py-1.5 bg-teal-600 text-white rounded-md text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving…' : 'Reschedule'}
          </button>
        </div>
      </div>
    </div>
  )
}

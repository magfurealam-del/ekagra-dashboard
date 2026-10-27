'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useDoctorBooking } from '@/hooks/useDoctorBooking'
import DoctorDatePicker from '@/components/DoctorDatePicker'

export default function RescheduleModal({
  appointment, onClose, onDone,
}: {
  appointment: { appointment_id: number; patient_name?: string; phone?: string; appointment_date?: string; appointment_time?: string; doctor_service?: string; service_type?: string; notes?: string }
  onClose: () => void
  onDone: () => void
}) {
  const [newDate, setNewDate] = useState(appointment.appointment_date || '')
  const [patientName, setPatientName] = useState(appointment.patient_name || '')
  const [phone, setPhone] = useState(appointment.phone || '')
  const [newTime, setNewTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const booking=useDoctorBooking(appointment.doctor_service || '',newDate)
  const slots=booking.slots, availabilityNote=booking.note

  function formatSlot(t: string) {
    const [h, m] = t.split(':').map(Number)
    const ampm = h >= 12 ? 'pm' : 'am'
    let h12 = h % 12
    if (h12 === 0) h12 = 12
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
  }

  async function submit() {
    if (!newDate || !newTime || !slots.includes(newTime)) { setError('Pick a time within an available session.'); return }
    setSaving(true)
    setError('')
    const { error: patientError } = await supabase.rpc('link_or_update_appointment_patient', {
      p_appointment_id: appointment.appointment_id,
      p_full_name: patientName.trim(),
      p_phone: phone.trim(),
      p_hn: null,
    })
    if (patientError) { setSaving(false); setError(patientError.message); return }
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

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-medium text-slate-500">
            Patient name
            <input className="input w-full mt-1" value={patientName} onChange={(e) => setPatientName(e.target.value)} />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            Phone number
            <input className="input w-full mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-xs">
          <div className="font-medium text-slate-600">Appointment context</div>
          <div><span className="text-slate-500">Doctor:</span> {appointment.doctor_service || 'Unassigned'}</div>
          <div><span className="text-slate-500">Service type:</span> {appointment.service_type || 'Unspecified'}</div>
          <div><span className="text-slate-500">Comments:</span> {appointment.notes || 'No comments recorded'}</div>
        </div>

        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">New date</span>
          <DoctorDatePicker
            doctorName={appointment.doctor_service || ''}
            value={newDate}
            onChange={(v) => { setNewDate(v); setNewTime('') }}
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">New time</span>
          <select className="input w-full" value={newTime} onChange={(e) => setNewTime(e.target.value)} disabled={slots.length === 0}>
            <option value="">Select…</option>
            {slots.map((s) => <option key={s} value={s}>{formatSlot(s)}</option>)}
          </select>
          {newDate && slots.length === 0 && (
            <span className="text-xs text-rose-600 mt-1 block">
              {availabilityNote || 'No slots configured for this doctor on this day — check Settings.'}
            </span>
          )}
          {newDate && slots.length > 0 && availabilityNote && (
            <span className="text-xs text-amber-600 mt-1 block">{availabilityNote}</span>
          )}
        </label>

        {booking.error && <button type="button" className="text-xs underline" onClick={booking.refresh}>Retry availability</button>}
        {error && <p className="text-xs text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 border border-slate-300 rounded-md text-sm text-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving||booking.loading||!slots.includes(newTime)} className="px-3 py-1.5 bg-teal-600 text-white rounded-md text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving…' : 'Reschedule'}
          </button>
        </div>
      </div>
    </div>
  )
}

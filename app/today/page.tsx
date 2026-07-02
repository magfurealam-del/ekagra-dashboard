'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useDropdownOptions } from '@/hooks/useDropdownOptions'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export default function TodayAppointmentsPage() {
  const [date, setDate] = useState(todayStr())
  const [statusFilter, setStatusFilter] = useState('')
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const apptStatusOpts = useDropdownOptions('appointment_status')

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function load() {
    setLoading(true)
    let q = supabase.from('today_appointments_view').select('*').order('appointment_time', { ascending: true })
    if (date) q = q.eq('appointment_date', date)
    if (statusFilter) q = q.eq('appointment_status', statusFilter)
    const { data, error } = await q
    if (!error && data) setRows(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // Live-sync with any change made from the Calendar or Lead Intake page:
    // new appointments, status/notes edits, or patient name/phone corrections.
    const channel = supabase
      .channel('today-appts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_appointments' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_leads' }, () => load())
      .subscribe()
    const interval = setInterval(load, 45000)
    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, statusFilter])

  async function updateStatus(appointmentId: number, status: string, notes: string) {
    const { error } = await supabase.rpc('update_appointment_status', {
      p_appointment_id: appointmentId, p_status: status, p_confirmation_status: null, p_notes: notes,
    })
    if (error) { showToast('Update failed: ' + error.message); return }
    showToast('Appointment status updated.')
    load()
  }

  async function updateHospitalId(patientId: number, hospitalId: string) {
    const { error } = await supabase.rpc('update_hospital_patient_id', {
      p_patient_id: patientId, p_hospital_patient_id: hospitalId,
    })
    if (error) { showToast('Update failed: ' + error.message); return }
    showToast('Hospital patient ID updated.')
    load()
  }

  async function updatePatientInfo(patientId: number, fullName: string, phone: string) {
    const { error } = await supabase.from('patients').update({ full_name: fullName, phone }).eq('id', patientId)
    if (error) { showToast('Update failed: ' + error.message); return }
    showToast('Patient info updated.')
    load()
  }

  return (
    <div className="space-y-4 pb-20">
      <h1 className="text-2xl font-semibold">Today&apos;s Appointments</h1>

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
        <label className="text-sm">
          <span className="block text-xs text-slate-500 mb-1">Date</span>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500 mb-1">Status</span>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            {apptStatusOpts.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <button onClick={load} className="bg-teal-600 text-white px-4 py-2 rounded-md text-sm font-medium">Refresh</button>
        <p className="text-xs text-slate-400 ml-auto self-center">
          Status options are managed in Settings → Dropdown options → appointment status.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        {loading ? (
          <p className="p-4 text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No appointments for this filter.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Time</th>
                <th className="text-left px-3 py-2">Patient</th>
                <th className="text-left px-3 py-2">Phone</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Hospital ID</th>
                <th className="text-left px-3 py-2">Doctor / service</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.appointment_id} r={r} statusOpts={apptStatusOpts.options}
                  onUpdateStatus={updateStatus} onUpdateHospitalId={updateHospitalId} onUpdatePatientInfo={updatePatientInfo} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-sm px-4 py-3 rounded-md shadow-lg">{toast}</div>
      )}
    </div>
  )
}

function Row({ r, statusOpts, onUpdateStatus, onUpdateHospitalId, onUpdatePatientInfo }: any) {
  const [status, setStatus] = useState(r.appointment_status || 'Booked')
  const [notes, setNotes] = useState(r.notes || '')
  const [hospitalId, setHospitalId] = useState(r.hospital_patient_id || '')
  const [patientName, setPatientName] = useState(r.patient_name || '')
  const [phone, setPhone] = useState(r.phone || '')

  return (
    <tr className="border-t border-slate-100">
      <td className="px-3 py-2">{r.appointment_time}</td>
      <td className="px-3 py-2 font-medium">
        {r.patient_id ? (
          <input
            className="input w-40"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            onBlur={() => patientName !== r.patient_name && onUpdatePatientInfo(r.patient_id, patientName, phone)}
          />
        ) : (
          patientName || '—'
        )}
      </td>
      <td className="px-3 py-2">
        {r.patient_id ? (
          <input
            className="input w-32"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => phone !== r.phone && onUpdatePatientInfo(r.patient_id, patientName, phone)}
          />
        ) : (
          phone || '—'
        )}
      </td>
      <td className="px-3 py-2">{r.patient_type}</td>
      <td className="px-3 py-2">
        <input className="input w-28" value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}
          onBlur={() => hospitalId !== r.hospital_patient_id && onUpdateHospitalId(r.patient_id, hospitalId)} />
      </td>
      <td className="px-3 py-2">{r.doctor_service}</td>
      <td className="px-3 py-2">
        <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); onUpdateStatus(r.appointment_id, e.target.value, notes) }}>
          {statusOpts.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td className="px-3 py-2">
        <input className="input w-40" value={notes} onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== r.notes && onUpdateStatus(r.appointment_id, status, notes)} />
      </td>
    </tr>
  )
}

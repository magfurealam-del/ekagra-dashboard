'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function PatientProfilePage() {
  const params = useParams()
  const id = Number(params.id)
  const [patient, setPatient] = useState<any>(null)
  const [leads, setLeads] = useState<any[]>([])
  const [appointments, setAppointments] = useState<any[]>([])
  const [followUps, setFollowUps] = useState<any[]>([])
  const [calls, setCalls] = useState<any[]>([])
  const [hospitalId, setHospitalId] = useState('')
  const [toast, setToast] = useState('')

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function load() {
    const [{ data: p }, { data: l }, { data: a }, { data: f }, { data: c }] = await Promise.all([
      supabase.from('patients').select('*').eq('id', id).single(),
      supabase.from('crm_leads').select('*').eq('patient_id', id).order('created_at', { ascending: false }),
      supabase.from('crm_appointments').select('*').eq('patient_id', id).order('appointment_date', { ascending: false }),
      supabase.from('crm_follow_ups').select('*').eq('patient_id', id).order('call_date', { ascending: false }),
      supabase.from('crm_call_interactions').select('*').eq('patient_id', id).order('call_started_at', { ascending: false }),
    ])
    setPatient(p)
    setHospitalId(p?.hospital_patient_id || '')
    setLeads(l || [])
    setAppointments(a || [])
    setFollowUps(f || [])
    setCalls(c || [])
  }

  useEffect(() => {
    if (id) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function saveHospitalId() {
    const { error } = await supabase.rpc('update_hospital_patient_id', { p_patient_id: id, p_hospital_patient_id: hospitalId })
    if (error) { showToast('Update failed: ' + error.message); return }
    showToast('Hospital patient ID updated.')
    load()
  }

  if (!patient) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="space-y-6 pb-20">
      <h1 className="text-2xl font-semibold">{patient.full_name}</h1>

      <div className="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <Info label="Phone" v={patient.phone} />
        <Info label="Secondary phone" v={patient.secondary_phone} />
        <Info label="Patient type" v={patient.patient_type} />
        <Info label="Area" v={patient.area} />
        <Info label="Diabetes status" v={patient.diabetes_status} />
        <Info label="Healing status" v={patient.healing_status} />
        <Info label="Notes" v={patient.crm_notes} />
        <div>
          <div className="text-xs text-slate-400 mb-1">Hospital patient ID</div>
          <div className="flex gap-1">
            <input className="input" value={hospitalId} onChange={(e) => setHospitalId(e.target.value)} />
            <button onClick={saveHospitalId} className="bg-teal-600 text-white px-2 rounded-md text-xs">Save</button>
          </div>
        </div>
      </div>

      <Section title="Appointment history">
        {appointments.length === 0 ? <Empty /> : (
          <Table cols={['Date', 'Time', 'Doctor/service', 'Status', 'Confirmation', 'Notes']}
            rows={appointments.map((a) => [a.appointment_date, a.appointment_time, a.doctor_service, a.appointment_status, a.confirmation_status, a.notes])} />
        )}
      </Section>

      <Section title="Lead history">
        {leads.length === 0 ? <Empty /> : (
          <Table cols={['Date', 'Source', 'Status', 'Main problem', 'Agent']}
            rows={leads.map((l) => [l.created_at?.slice(0, 10), l.source, l.lead_status, l.main_problem, l.agent_name])} />
        )}
      </Section>

      <Section title="Follow-up history">
        {followUps.length === 0 ? <Empty /> : (
          <Table cols={['Call date', '#', 'Outcome', 'Next follow-up', 'Agent']}
            rows={followUps.map((f) => [f.call_date, f.follow_up_number, f.outcome, f.next_follow_up_date, f.agent_name])} />
        )}
      </Section>

      <Section title="Call center interaction history">
        {calls.length === 0 ? <Empty /> : (
          <Table cols={['Date', 'Direction', 'Outcome', 'Agent', 'Summary']}
            rows={calls.map((c) => [c.call_started_at?.slice(0, 16).replace('T', ' '), c.call_direction, c.call_outcome, c.agent_name, c.summary])} />
        )}
      </Section>

      {toast && <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-sm px-4 py-3 rounded-md shadow-lg">{toast}</div>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <h2 className="font-medium text-slate-700">{title}</h2>
      {children}
    </div>
  )
}

function Empty() {
  return <p className="text-sm text-slate-400">No records yet.</p>
}

function Table({ cols, rows }: { cols: string[]; rows: any[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-400 uppercase">
          <tr>{cols.map((c) => <th key={c} className="text-left px-2 py-1">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {r.map((v, j) => <td key={j} className="px-2 py-1">{v ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Info({ label, v }: { label: string; v: any }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-slate-800">{v || '—'}</div>
    </div>
  )
}

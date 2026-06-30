'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeBdPhone } from '@/lib/phone'
import SearchableSelect from '@/components/SearchableSelect'
import { useDropdownOptions } from '@/hooks/useDropdownOptions'

type SearchState = 'idle' | 'searching' | 'new' | 'existing_patient' | 'old_lead' | 'multiple_matches'

export default function AddLeadPage() {
  const [phone, setPhone] = useState('')
  const [state, setState] = useState<SearchState>('idle')
  const [patients, setPatients] = useState<any[]>([])
  const [leads, setLeads] = useState<any[]>([])
  const [selectedPatient, setSelectedPatient] = useState<any | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [toast, setToast] = useState('')

  const leadSourceOpts = useDropdownOptions('lead_source')
  const patientTypeOpts = useDropdownOptions('patient_type')
  const leadStatusOpts = useDropdownOptions('lead_status')
  const diabetesOpts = useDropdownOptions('diabetes_status')
  const genderOpts = useDropdownOptions('gender')
  const apptStatusOpts = useDropdownOptions('appointment_status')
  const confirmStatusOpts = useDropdownOptions('confirmation_status')

  const blankForm = {
    patient_name: '', phone: '', secondary_phone: '', age: '', gender: '', area: '',
    diabetes_status: '', hospital_patient_id: '', patient_type: '', notes: '',
    source: '', main_problem: '', lead_status: 'No Appointment Booked', agent_name: '', campaign_name: '', internal_notes: '',
    appointment_date: '', appointment_time: '', doctor_service: '', appointment_type: '',
    appointment_status: 'Booked', confirmation_status: 'Not Confirmed', visit_notes: '',
  }
  const [form, setForm] = useState<any>(blankForm)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  async function runSearch() {
    if (phone.replace(/\D/g, '').length < 7) return
    setState('searching')
    const { data, error } = await supabase.rpc('search_patient_by_phone', { phone_input: phone })
    if (error) {
      showToast('Search failed: ' + error.message)
      setState('idle')
      return
    }
    const result = data as any
    setPatients(result.patients || [])
    setLeads(result.leads || [])
    setState(result.state)
    if (result.state === 'new') setForm((f: any) => ({ ...f, phone }))
  }

  function startIntakeFromPatient(p: any) {
    setSelectedPatient(p)
    setForm((f: any) => ({
      ...f,
      patient_name: p.patient_name || '',
      phone: p.phone || phone,
      hospital_patient_id: p.hospital_patient_id || '',
      patient_type: p.patient_type || '',
      notes: p.last_note || '',
    }))
    setShowForm(true)
  }

  function startIntakeFromLead(l: any) {
    setSelectedPatient(null)
    setForm((f: any) => ({
      ...f,
      patient_name: l.lead_name || '',
      phone: l.phone || phone,
      patient_type: l.patient_type || '',
      source: l.source || '',
      main_problem: l.main_problem || '',
      agent_name: l.agent_name || '',
      internal_notes: l.notes || '',
    }))
    setShowForm(true)
  }

  function startNewIntake() {
    setSelectedPatient(null)
    setForm((f: any) => ({ ...f, phone }))
    setShowForm(true)
  }

  async function refetchSearch() {
    const { data } = await supabase.rpc('search_patient_by_phone', { phone_input: phone })
    if (data) {
      setPatients(data.patients || [])
      setLeads(data.leads || [])
    }
  }

  async function handleSave(bookAppointment: boolean) {
    if (!form.patient_name || !form.phone) {
      showToast('Patient name and phone are required.')
      return
    }
    const patientId = await supabase.rpc('upsert_patient_from_intake', {
      payload: {
        patient_name: form.patient_name, phone: form.phone, secondary_phone: form.secondary_phone,
        gender: form.gender, address: form.area, area: form.area, diabetes_status: form.diabetes_status,
        hospital_patient_id: form.hospital_patient_id, patient_type: form.patient_type, notes: form.notes,
        updated_by: form.agent_name || 'agent',
      },
    })
    if (patientId.error) { showToast('Error saving patient: ' + patientId.error.message); return }
    const pid = patientId.data as number
    showToast(selectedPatient ? 'Existing patient updated.' : 'New patient created.')

    const leadId = await supabase.rpc('create_lead_for_patient', {
      payload: {
        patient_id: pid, lead_name: form.patient_name, phone: form.phone, source: form.source,
        campaign_name: form.campaign_name, patient_type: form.patient_type, main_problem: form.main_problem,
        lead_status: bookAppointment ? 'Appointment Booked' : form.lead_status,
        agent_name: form.agent_name, notes: form.internal_notes,
      },
    })
    if (leadId.error) { showToast('Error saving lead: ' + leadId.error.message); return }
    showToast('Lead saved.')

    if (bookAppointment && form.appointment_date) {
      const apptId = await supabase.rpc('book_appointment', {
        payload: {
          patient_id: pid, lead_id: leadId.data, appointment_date: form.appointment_date,
          appointment_time: form.appointment_time, doctor_service: form.doctor_service,
          appointment_type: form.appointment_type, appointment_status: form.appointment_status,
          confirmation_status: form.confirmation_status, notes: form.visit_notes, created_by: form.agent_name || 'agent',
        },
      })
      if (apptId.error) { showToast('Error booking appointment: ' + apptId.error.message); return }
      showToast('Appointment booked.')
    }

    showToast('Latest Supabase data loaded.')
    await refetchSearch()
    setShowForm(false)
  }

  function clearAll() {
    setPhone('')
    setState('idle')
    setPatients([])
    setLeads([])
    setSelectedPatient(null)
    setShowForm(false)
    setForm(blankForm)
  }

  return (
    <div className="space-y-6 pb-20">
      <h1 className="text-2xl font-semibold">Add Lead / Book Appointment</h1>

      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
        <h2 className="font-medium text-slate-700">Step 1: Search Patient by Phone Number</h2>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="e.g. 017XXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          />
          <button onClick={runSearch} className="bg-teal-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-teal-700">
            Search
          </button>
        </div>
        {phone && <p className="text-xs text-slate-400">Normalized: {normalizeBdPhone(phone)}</p>}
      </div>

      {state === 'searching' && <p className="text-sm text-slate-500">Searching Supabase…</p>}

      {state === 'new' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <p className="font-medium text-amber-700">New patient / new lead</p>
          <button onClick={startNewIntake} className="bg-teal-600 text-white px-4 py-2 rounded-md text-sm font-medium">
            Create New Patient
          </button>
        </div>
      )}

      {state === 'existing_patient' && patients[0] && (
        <PatientCard p={patients[0]} onUse={() => startIntakeFromPatient(patients[0])} />
      )}

      {state === 'old_lead' && leads[0] && (
        <LeadCard l={leads[0]} onUse={() => startIntakeFromLead(leads[0])} />
      )}

      {state === 'multiple_matches' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <p className="font-medium text-amber-700">Multiple possible matches</p>
          <div className="space-y-2">
            {patients.map((p) => (
              <div key={p.patient_id} className="flex items-center justify-between border border-slate-200 rounded-md px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{p.patient_name}</span> · {p.phone} · {p.hospital_patient_id || 'no ID'} · {p.last_appointment_status || 'no appt'}
                </div>
                <button onClick={() => startIntakeFromPatient(p)} className="text-teal-700 text-xs font-medium">Select</button>
              </div>
            ))}
          </div>
          <button onClick={startNewIntake} className="text-xs text-amber-700 underline">
            Create new patient anyway (possible duplicate)
          </button>
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-6">
          <section className="space-y-3">
            <h2 className="font-medium text-slate-700">Patient Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Patient name *">
                <input className="input" value={form.patient_name} onChange={(e) => setForm({ ...form, patient_name: e.target.value })} />
              </Field>
              <Field label="Phone number *">
                <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label="Secondary phone">
                <input className="input" value={form.secondary_phone} onChange={(e) => setForm({ ...form, secondary_phone: e.target.value })} />
              </Field>
              <Field label="Age">
                <input className="input" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
              </Field>
              <Field label="Gender">
                <SearchableSelect options={genderOpts.options} value={form.gender} onChange={(v) => setForm({ ...form, gender: v })} />
              </Field>
              <Field label="Area / address">
                <input className="input" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
              </Field>
              <Field label="Diabetes status">
                <SearchableSelect options={diabetesOpts.options} value={form.diabetes_status} onChange={(v) => setForm({ ...form, diabetes_status: v })} />
              </Field>
              <Field label="Hospital patient ID (often added later)">
                <input className="input" value={form.hospital_patient_id} onChange={(e) => setForm({ ...form, hospital_patient_id: e.target.value })} />
              </Field>
              <Field label="Patient type">
                <SearchableSelect options={patientTypeOpts.options} value={form.patient_type} onChange={(v) => setForm({ ...form, patient_type: v })} />
              </Field>
              <Field label="Notes">
                <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-medium text-slate-700">Lead Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Lead source">
                <SearchableSelect options={leadSourceOpts.options} value={form.source} onChange={(v) => setForm({ ...form, source: v })} />
              </Field>
              <Field label="Main problem / reason for visit">
                <input className="input" value={form.main_problem} onChange={(e) => setForm({ ...form, main_problem: e.target.value })} />
              </Field>
              <Field label="Lead status">
                <SearchableSelect options={leadStatusOpts.options} value={form.lead_status} onChange={(v) => setForm({ ...form, lead_status: v })} />
              </Field>
              <Field label="Agent name">
                <input className="input" value={form.agent_name} onChange={(e) => setForm({ ...form, agent_name: e.target.value })} placeholder="Yakub / Fatema" />
              </Field>
              <Field label="Campaign name">
                <input className="input" value={form.campaign_name} onChange={(e) => setForm({ ...form, campaign_name: e.target.value })} />
              </Field>
              <Field label="Internal notes">
                <input className="input" value={form.internal_notes} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-medium text-slate-700">Appointment Booking</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Appointment date">
                <input type="date" className="input" value={form.appointment_date} onChange={(e) => setForm({ ...form, appointment_date: e.target.value })} />
              </Field>
              <Field label="Appointment time">
                <input type="time" className="input" value={form.appointment_time} onChange={(e) => setForm({ ...form, appointment_time: e.target.value })} />
              </Field>
              <Field label="Doctor / service">
                <input className="input" value={form.doctor_service} onChange={(e) => setForm({ ...form, doctor_service: e.target.value })} />
              </Field>
              <Field label="Appointment type">
                <input className="input" value={form.appointment_type} onChange={(e) => setForm({ ...form, appointment_type: e.target.value })} />
              </Field>
              <Field label="Appointment status">
                <SearchableSelect options={apptStatusOpts.options} value={form.appointment_status} onChange={(v) => setForm({ ...form, appointment_status: v })} />
              </Field>
              <Field label="Confirmation status">
                <SearchableSelect options={confirmStatusOpts.options} value={form.confirmation_status} onChange={(v) => setForm({ ...form, confirmation_status: v })} />
              </Field>
              <Field label="Visit notes">
                <input className="input" value={form.visit_notes} onChange={(e) => setForm({ ...form, visit_notes: e.target.value })} />
              </Field>
            </div>
          </section>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
            <button onClick={() => handleSave(false)} className="bg-slate-700 text-white px-4 py-2 rounded-md text-sm font-medium">Save lead only</button>
            <button onClick={() => handleSave(true)} className="bg-teal-600 text-white px-4 py-2 rounded-md text-sm font-medium">Save lead and book appointment</button>
            <button onClick={clearAll} className="border border-slate-300 px-4 py-2 rounded-md text-sm font-medium">Clear form</button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-sm px-4 py-3 rounded-md shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

function PatientCard({ p, onUse }: { p: any; onUse: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <p className="font-medium text-teal-700">Existing patient found</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
        <Info label="Name" v={p.patient_name} />
        <Info label="Phone" v={p.phone} />
        <Info label="Hospital ID" v={p.hospital_patient_id} />
        <Info label="Patient type" v={p.patient_type} />
        <Info label="Last appointment" v={p.last_appointment_date} />
        <Info label="Last status" v={p.last_appointment_status} />
        <Info label="Total appointments" v={p.total_appointments} />
        <Info label="No-show count" v={p.no_show_count} />
        <Info label="Last note" v={p.last_note} />
      </div>
      <button onClick={onUse} className="bg-teal-600 text-white px-4 py-2 rounded-md text-sm font-medium">Use this patient</button>
    </div>
  )
}

function LeadCard({ l, onUse }: { l: any; onUse: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <p className="font-medium text-sky-700">Old lead found, but no patient record</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
        <Info label="Name" v={l.lead_name} />
        <Info label="Phone" v={l.phone} />
        <Info label="Source" v={l.source} />
        <Info label="Status" v={l.lead_status} />
        <Info label="Main problem" v={l.main_problem} />
        <Info label="Agent" v={l.agent_name} />
      </div>
      <button onClick={onUse} className="bg-sky-600 text-white px-4 py-2 rounded-md text-sm font-medium">Convert to patient</button>
    </div>
  )
}

function Info({ label, v }: { label: string; v: any }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-slate-800">{v ?? '—'}</div>
    </div>
  )
}

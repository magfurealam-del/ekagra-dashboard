'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeBdPhone } from '@/lib/phone'
import SearchableSelect from '@/components/SearchableSelect'
import { useDropdownOptions } from '@/hooks/useDropdownOptions'
import {
  FOLLOWUP_QUEUE_OUTCOMES, CALLBACK_OUTCOMES, SUPPRESSED_OUTCOMES,
  defaultPriority,
} from '@/lib/leadIntakeOptions'

const blankForm = {
  lead_date: new Date().toISOString().slice(0, 10),
  patient_name: '',
  phone: '',
  age: '',
  gender: '',
  location: '',
  new_old_status: 'New',
  source_channel: '',
  campaign_bucket: '',
  agent_name: '',

  lead_bucket: '',
  main_concern: '',
  urgency: 'Routine',
  diabetes_status: '',
  notes: '',

  intake_outcome: 'no_appointment_yet',
  doctor: '',
  service_type: '',
  branch: 'Dhanmondi',
  appointment_date: '',
  appointment_time: '',
  call_status_note: '',
  internal_note: '',
}

const CALL_STATUS_DEFAULTS: Record<string, string> = {
  appointment_booked: 'উনি কল দিয়েছেন',
  no_appointment_yet: 'কল রিসিভ হয়েছে, এপয়েন্টমেন্ট এখনো হয়নি',
  call_later: 'পরে কল করতে বলেছেন',
  not_reached: 'কল রিসিভ হয়নি',
  busy: 'লাইন ব্যস্ত ছিল',
  switched_off: 'ফোন বন্ধ ছিল',
  wrong_number: 'ভুল নম্বর',
  not_interested: 'আগ্রহী নন',
  general_inquiry: 'সাধারণ জিজ্ঞাসা',
}

function formatDateDMY(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${parseInt(d, 10)}/${parseInt(m, 10)}/${y.slice(2)}`
}

function formatTime12h(t: string): string {
  if (!t) return ''
  const [hStr, mStr] = t.split(':')
  let h = parseInt(hStr, 10)
  const ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12
  if (h === 0) h = 12
  return `${h}.${mStr} ${ampm}`
}

export default function LeadIntakePage() {
  const [phone, setPhone] = useState('')
  const [patientIdQuery, setPatientIdQuery] = useState('')
  const [nameQuery, setNameQuery] = useState('')
  const [lookupState, setLookupState] = useState<'idle' | 'searching' | 'found' | 'multiple' | 'new'>('idle')
  const [matches, setMatches] = useState<any[]>([])
  const [patientCard, setPatientCard] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [copyLabel, setCopyLabel] = useState('Copy Message')
  const [form, setForm] = useState<any>(blankForm)

  const doctorOpts = useDoctors()
  const serviceTypeOpts = useDropdownOptions('service_type')
  const branchOpts = useDropdownOptions('branch')
  const genderOpts = useDropdownOptions('gender')
  const sourceChannelOpts = useDropdownOptions('intake_source_channel')
  const campaignBucketOpts = useDropdownOptions('intake_campaign_bucket')
  const leadBucketOpts = useDropdownOptions('intake_lead_bucket')
  const mainConcernOpts = useDropdownOptions('intake_main_concern')
  const urgencyOpts = useDropdownOptions('intake_urgency')
  const newOldStatusOpts = useDropdownOptions('intake_new_old_status')
  const intakeOutcomeOpts = useDropdownOptions('intake_outcome')
  const timeSlots = useDoctorSlots(form.doctor, form.appointment_date)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  function set<K extends keyof typeof blankForm>(key: K, value: any) {
    setForm((f: any) => ({ ...f, [key]: value }))
  }

  // Suggest a call-status note whenever intake outcome changes, unless the agent already typed one
  function handleOutcomeChange(outcome: string) {
    setForm((f: any) => ({
      ...f,
      intake_outcome: outcome,
      call_status_note: f.call_status_note && f.call_status_note !== CALL_STATUS_DEFAULTS[f.intake_outcome]
        ? f.call_status_note
        : CALL_STATUS_DEFAULTS[outcome] || '',
    }))
  }

  async function runPhoneSearch() {
    if (phone.replace(/\D/g, '').length < 7) return
    setLookupState('searching')
    const { data, error } = await supabase.rpc('search_patient_by_phone', { phone_input: phone })
    if (error) { showToast('Search failed: ' + error.message); setLookupState('idle'); return }
    const result = data as any
    const foundPatients = result.patients || []
    if (foundPatients.length > 1) {
      setMatches(foundPatients)
      setLookupState('multiple')
    } else if (foundPatients.length === 1) {
      await loadPatientCard(foundPatients[0].patient_id)
      setLookupState('found')
    } else {
      setLookupState('new')
      set('phone', normalizeBdPhone(phone))
      set('new_old_status', 'New')
    }
  }

  async function loadPatientCard(patientId: number) {
    const { data } = await supabase.from('patient_master_view').select('*').eq('patient_id', patientId).single()
    if (data) {
      setPatientCard(data)
      setForm((f: any) => ({
        ...f,
        patient_name: data.patient_name || '',
        phone: data.phone_e164 || data.phone || phone,
        location: data.area || '',
        new_old_status: 'Old',
      }))
      setLookupState('found')
      setMatches([])
    }
  }

  async function searchByPatientId() {
    if (!patientIdQuery) return
    setLookupState('searching')
    const { data } = await supabase
      .from('patient_master_view')
      .select('*')
      .or(`hospital_id.ilike.%${patientIdQuery}%`)
      .limit(5)
    if (data && data.length === 1) { await loadPatientCard(data[0].patient_id) }
    else if (data && data.length > 1) { setMatches(data.map((d: any) => ({ ...d, patient_id: d.patient_id }))); setLookupState('multiple') }
    else { setLookupState('new'); showToast('No patient found with that ID.') }
  }

  async function searchByName() {
    if (!nameQuery) return
    setLookupState('searching')
    const { data } = await supabase
      .from('patient_master_view')
      .select('*')
      .ilike('patient_name', `%${nameQuery}%`)
      .limit(5)
    if (data && data.length === 1) { await loadPatientCard(data[0].patient_id) }
    else if (data && data.length > 1) { setMatches(data); setLookupState('multiple') }
    else { setLookupState('new'); showToast('No patient found with that name.') }
  }

  function markNewPatient() {
    setPatientCard(null)
    setMatches([])
    setLookupState('new')
    set('new_old_status', 'New')
  }

  const requiresAppointmentFields = form.intake_outcome === 'appointment_booked'
  const isSuppressed = SUPPRESSED_OUTCOMES.includes(form.intake_outcome)

  function validate(effectiveOutcome: string): string | null {
    if (!form.patient_name) return 'Patient name is required.'
    if (!form.phone) return 'Phone number is required.'
    if (effectiveOutcome === 'appointment_booked') {
      if (!form.doctor || !form.service_type || !form.branch || !form.appointment_date || !form.appointment_time) {
        return 'Doctor, service type, branch, date, and time are required to book an appointment.'
      }
    }
    return null
  }

  async function save() {
    const effectiveOutcome = form.intake_outcome
    const err = validate(effectiveOutcome)
    if (err) { showToast(err); return }

    setSaving(true)
    const autoPriority = defaultPriority(form.lead_bucket, form.urgency, effectiveOutcome)

    const { data, error } = await supabase.rpc('save_lead_intake', {
      payload: {
        patient_name: form.patient_name,
        phone: form.phone,
        gender: form.gender,
        location: form.location,
        new_old_status: form.new_old_status,
        source_channel: form.source_channel,
        campaign_bucket: form.campaign_bucket,
        agent_name: form.agent_name,
        lead_bucket: form.lead_bucket,
        main_concern: form.main_concern,
        urgency: form.urgency,
        diabetes_status: form.diabetes_status,
        notes: form.notes,
        intake_outcome: effectiveOutcome,
        doctor: form.doctor,
        service_type: form.service_type,
        branch: form.branch,
        appointment_date: form.appointment_date || null,
        appointment_time: form.appointment_time || null,
        follow_up_due_at: null,
        follow_up_priority: autoPriority,
        internal_note: form.internal_note || form.call_status_note,
      },
    })
    setSaving(false)
    if (error) { showToast('Save failed: ' + error.message); return }

    if (effectiveOutcome === 'appointment_booked') showToast('Lead saved and appointment booked.')
    else if (FOLLOWUP_QUEUE_OUTCOMES.includes(effectiveOutcome) || CALLBACK_OUTCOMES.includes(effectiveOutcome)) showToast('Lead saved and added to follow-up queue.')
    else showToast('Lead saved.')

    const keepAgent = form.agent_name
    setForm({ ...blankForm, agent_name: keepAgent })
    setPhone('')
    setPatientIdQuery('')
    setNameQuery('')
    setPatientCard(null)
    setMatches([])
    setLookupState('idle')
    setCopyLabel('Copy Message')
  }

  return (
    <div className="space-y-4 pb-28">
      <div>
        <h1 className="text-2xl font-semibold">Lead Intake & Appointment</h1>
        <p className="text-sm text-slate-500">Fast patient intake, booking, and follow-up</p>
      </div>

      {/* Section 1: Patient Lookup */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
        <SectionTitle n={1} title="Patient Lookup" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Phone number (primary lookup)">
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="e.g. 017XXXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runPhoneSearch()}
              />
              <button onClick={runPhoneSearch} className="bg-teal-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-teal-700">
                Search
              </button>
            </div>
          </Field>
          <Field label="Patient ID">
            <div className="flex gap-2">
              <input className="input flex-1" placeholder="e.g. H12606000913" value={patientIdQuery}
                onChange={(e) => setPatientIdQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchByPatientId()} />
              <button onClick={searchByPatientId} className="border border-slate-300 px-3 py-2 rounded-md text-sm">Search</button>
            </div>
          </Field>
          <Field label="Patient name">
            <div className="flex gap-2">
              <input className="input flex-1" placeholder="e.g. Ramesh Mehta" value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchByName()} />
              <button onClick={searchByName} className="border border-slate-300 px-3 py-2 rounded-md text-sm">Search</button>
            </div>
          </Field>
        </div>

        {lookupState === 'multiple' && (
          <div className="border border-amber-200 bg-amber-50 rounded-md p-3 space-y-2">
            <p className="text-sm text-amber-800">Multiple matches found — select the right patient:</p>
            {matches.map((p: any) => (
              <div key={p.patient_id} className="flex items-center justify-between text-sm bg-white rounded px-3 py-2 border border-amber-100">
                <span>{p.patient_name} · {p.phone || p.phone_e164} · {p.hospital_id || 'no ID'}</span>
                <button onClick={() => loadPatientCard(p.patient_id)} className="text-teal-700 text-xs font-medium">Select</button>
              </div>
            ))}
            <button onClick={markNewPatient} className="text-xs text-amber-700 underline">None of these — create new patient</button>
          </div>
        )}

        {lookupState === 'found' && patientCard && (
          <div className="border border-teal-200 bg-teal-50 rounded-lg p-4 flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-teal-600 text-white flex items-center justify-center text-sm font-semibold">
                {(patientCard.patient_name || '?').slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-medium text-slate-800">{patientCard.patient_name}</p>
                <span className="inline-flex items-center gap-1 text-xs text-teal-700 font-medium">● Existing Patient</span>
              </div>
            </div>
            <MiniInfo label="Patient ID" v={patientCard.hospital_id} />
            <MiniInfo label="Phone" v={patientCard.phone_e164 || patientCard.phone} />
            <MiniInfo label="Location" v={patientCard.area} />
            <MiniInfo label="Last appointment" v={patientCard.last_appointment_date} />
            <MiniInfo label="No-show count" v={patientCard.no_show_count} />
            <MiniInfo label="Last call status" v={patientCard.last_call_status || patientCard.last_call_outcome} />
            <button onClick={markNewPatient} className="ml-auto text-xs text-slate-500 underline">Not this patient</button>
          </div>
        )}

        {lookupState === 'new' && (
          <div className="border border-slate-200 bg-slate-50 rounded-lg p-3 text-sm text-slate-600">
            No existing record found — this will be created as a <span className="font-medium">New Patient</span>.
          </div>
        )}
      </section>

      {/* Sections 2, 3, 4 side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Section 2: Lead Details */}
          <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
            <SectionTitle n={2} title="Lead Details" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Lead date *">
                <input type="date" className="input" value={form.lead_date} onChange={(e) => set('lead_date', e.target.value)} />
              </Field>
              <Field label="Patient name *">
                <input className="input" value={form.patient_name} onChange={(e) => set('patient_name', e.target.value)} />
              </Field>
              <Field label="Phone number *">
                <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field label="Age">
                <input className="input" value={form.age} onChange={(e) => set('age', e.target.value)} />
              </Field>
              <Field label="Gender">
                <SearchableSelect options={genderOpts.options} value={form.gender} onChange={(v) => set('gender', v)} />
              </Field>
              <Field label="Location">
                <input className="input" value={form.location} onChange={(e) => set('location', e.target.value)} />
              </Field>
              <Field label="New / Old / Unknown *">
                <SearchableSelect options={newOldStatusOpts.options} value={form.new_old_status} onChange={(v) => set('new_old_status', v)} />
              </Field>
              <Field label="Source channel *">
                <SearchableSelect options={sourceChannelOpts.options} value={form.source_channel} onChange={(v) => set('source_channel', v)} />
              </Field>
              <Field label="Campaign bucket">
                <SearchableSelect options={campaignBucketOpts.options} value={form.campaign_bucket} onChange={(v) => set('campaign_bucket', v)} />
              </Field>
              <Field label="Call center agent *">
                <input className="input" placeholder="Yakub / Fatema" value={form.agent_name} onChange={(e) => set('agent_name', e.target.value)} />
              </Field>
            </div>
          </section>

          {/* Section 3: Clinical / Reason */}
          <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
            <SectionTitle n={3} title="Clinical / Reason" />
            <Field label="Lead bucket *">
              <div className="flex flex-wrap gap-2">
                {leadBucketOpts.options.map((b) => (
                  <Chip key={b.value} active={form.lead_bucket === b.value} onClick={() => set('lead_bucket', b.value)}>{b.label}</Chip>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Main concern *">
                <SearchableSelect options={mainConcernOpts.options} value={form.main_concern} onChange={(v) => set('main_concern', v)} />
              </Field>
              <Field label="Urgency *">
                <div className="flex gap-2">
                  {urgencyOpts.options.map((u) => (
                    <Chip key={u.value} active={form.urgency === u.value} onClick={() => set('urgency', u.value)}>{u.label}</Chip>
                  ))}
                </div>
              </Field>
              <Field label="Diabetes">
                <div className="flex gap-2">
                  <Chip active={form.diabetes_status === 'Yes'} onClick={() => set('diabetes_status', 'Yes')}>Yes</Chip>
                  <Chip active={form.diabetes_status === 'No'} onClick={() => set('diabetes_status', 'No')}>No</Chip>
                </div>
              </Field>
            </div>
            <Field label="Short notes">
              <textarea
                className="input min-h-[70px]"
                maxLength={300}
                placeholder="Short reason for call or patient concern."
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
              <span className="text-xs text-slate-400">{form.notes.length}/300</span>
            </Field>
          </section>

        {/* Section 4: Appointment / Follow-up Decision */}
        <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 lg:h-fit">
          <SectionTitle n={4} title="Appointment / Follow-up Decision" />
          <Field label="Intake outcome *">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {intakeOutcomeOpts.options.map((o) => (
                <Chip key={o.value} active={form.intake_outcome === o.value} onClick={() => handleOutcomeChange(o.value)}>
                  {o.label}
                </Chip>
              ))}
            </div>
          </Field>

          {requiresAppointmentFields && (
            <div className="border-t border-slate-100 pt-3 space-y-3">
              <p className="text-xs font-medium text-slate-500 uppercase">Appointment details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Doctor *">
                  <SearchableSelect options={doctorOpts} value={form.doctor} onChange={(v) => set('doctor', v)} />
                </Field>
                <Field label="Service type *">
                  <SearchableSelect options={serviceTypeOpts.options} value={form.service_type} onChange={(v) => set('service_type', v)} />
                </Field>
                <Field label="Branch *">
                  <SearchableSelect options={branchOpts.options} value={form.branch} onChange={(v) => set('branch', v)} />
                </Field>
                <Field label="Appointment date *">
                  <input type="date" className="input" value={form.appointment_date} onChange={(e) => set('appointment_date', e.target.value)} />
                </Field>
                <Field label="Appointment time *">
                  <SearchableSelect
                    options={timeSlots}
                    value={form.appointment_time}
                    onChange={(v) => set('appointment_time', v)}
                  />
                  {form.doctor && form.appointment_date && timeSlots.length === 0 && (
                    <span className="text-xs text-rose-600">No slots configured for this doctor on this day — check Settings.</span>
                  )}
                </Field>
              </div>
            </div>
          )}

          {(form.intake_outcome !== 'appointment_booked') && (
            <div className="border-t border-slate-100 pt-3">
              <Field label="Call status">
                <input
                  className="input"
                  value={form.call_status_note}
                  onChange={(e) => set('call_status_note', e.target.value)}
                  placeholder="e.g. উনি কল দিয়েছেন"
                />
              </Field>
            </div>
          )}

          {isSuppressed && (
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-500">This lead will be marked inactive / suppressed and will not enter the active follow-up queue.</p>
            </div>
          )}

          <Field label="Internal note">
            <textarea className="input min-h-[70px]" maxLength={250} value={form.internal_note} onChange={(e) => set('internal_note', e.target.value)} />
            <span className="text-xs text-slate-400">{form.internal_note.length}/250</span>
          </Field>
        </section>
      </div>

      {/* WhatsApp-ready message panel — full width below */}
      <WhatsAppPanel form={form} copyLabel={copyLabel} setCopyLabel={setCopyLabel} showToast={showToast} />

      {/* Sticky bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 flex z-30">
        <button disabled={saving} onClick={() => save()} className="bg-teal-600 text-white px-6 py-2.5 rounded-md text-sm font-medium disabled:opacity-50 ml-auto">
          {saving ? 'Saving…' : 'Save Lead'}
        </button>
      </div>

      {toast && (
        <div className="fixed bottom-20 right-6 bg-slate-900 text-white text-sm px-4 py-3 rounded-md shadow-lg z-40">
          {toast}
        </div>
      )}
    </div>
  )
}

function buildWhatsAppMessage(form: any): string {
  const lines: string[] = []
  lines.push(`Entry Type: ${form.new_old_status === 'New' ? 'New Call' : 'Follow-up Call'}`)
  lines.push(`Patient Name: ${form.patient_name || '—'}`)
  lines.push(`Contact Number: ${form.phone || '—'}`)
  if (form.call_status_note) lines.push(`Call Status: ${form.call_status_note}`)
  if (form.appointment_date) lines.push(`Appointment Date: ${formatDateDMY(form.appointment_date)}`)
  if (form.appointment_time) lines.push(`Appointment Time: ${formatTime12h(form.appointment_time)}`)
  if (form.service_type) lines.push(`Appointment For: ${form.service_type}`)
  if (form.doctor) lines.push(`Doctor/Service: ${form.doctor}`)
  if (form.location) lines.push(`Coming From: ${form.location}`)
  const concern = [form.main_concern, form.notes].filter(Boolean).join(', ')
  if (concern) lines.push(`Patient Concern: ${concern}`)
  return lines.join('\n')
}

function WhatsAppPanel({
  form, copyLabel, setCopyLabel, showToast,
}: {
  form: any
  copyLabel: string
  setCopyLabel: (v: string) => void
  showToast: (msg: string) => void
}) {
  const message = useMemo(() => buildWhatsAppMessage(form), [form])

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message)
      setCopyLabel('Copied!')
      setTimeout(() => setCopyLabel('Copy Message'), 2000)
    } catch {
      showToast('Could not copy — select and copy the text manually.')
    }
  }

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-slate-700 text-sm">WhatsApp Message</h2>
        <button
          onClick={copyMessage}
          className="bg-emerald-600 text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-emerald-700"
        >
          {copyLabel}
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-words text-xs bg-slate-50 border border-slate-200 rounded-md p-3 font-sans text-slate-700 min-h-[220px]">
        {message}
      </pre>
      <p className="text-xs text-slate-400">Updates live as you fill in the form. Tap Copy, then paste into WhatsApp.</p>
    </section>
  )
}

function useDoctorSlots(doctorName: string, dateStr: string): { label: string; value: string }[] {
  const [schedule, setSchedule] = useState<any[]>([])

  useEffect(() => {
    if (!doctorName) { setSchedule([]); return }
    supabase.from('doctor_schedules').select('*').eq('doctor_name', doctorName).eq('is_active', true).then(({ data }) => {
      setSchedule(data || [])
    })
  }, [doctorName])

  return useMemo(() => {
    if (!dateStr || schedule.length === 0) return []
    const dow = new Date(dateStr + 'T00:00:00').getDay()
    const day = schedule.find((s) => s.day_of_week === dow)
    if (!day) return []
    const [sh, sm] = day.start_time.slice(0, 5).split(':').map(Number)
    const [eh, em] = day.end_time.slice(0, 5).split(':').map(Number)
    const step = day.slot_minutes || 15
    const slots: { label: string; value: string }[] = []
    let mins = sh * 60 + sm
    const endMins = eh * 60 + em
    while (mins < endMins) {
      const h24 = Math.floor(mins / 60)
      const m = mins % 60
      const value = `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      const ampm = h24 >= 12 ? 'pm' : 'am'
      let h12 = h24 % 12
      if (h12 === 0) h12 = 12
      slots.push({ label: `${h12}:${String(m).padStart(2, '0')} ${ampm}`, value })
      mins += step
    }
    return slots
  }, [dateStr, schedule])
}

function useDoctors() {
  const [options, setOptions] = useState<{ label: string; value: string }[]>([])
  useEffect(() => {
    supabase.from('doctors').select('name').eq('is_active', true).order('name').then(({ data }) => {
      if (data) setOptions(data.map((d: any) => ({ label: d.name, value: d.name })))
    })
  }, [])
  return options
}

function SectionTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-5 h-5 rounded bg-teal-600 text-white text-xs font-semibold flex items-center justify-center">{n}</span>
      <h2 className="font-medium text-slate-700">{title}</h2>
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
        active ? 'bg-teal-50 border-teal-500 text-teal-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )
}

function MiniInfo({ label, v }: { label: string; v: any }) {
  return (
    <div className="text-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-slate-800 font-medium">{v ?? '—'}</div>
    </div>
  )
}

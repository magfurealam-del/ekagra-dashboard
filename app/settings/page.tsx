'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const CATEGORIES = [
  'intake_source_channel', 'intake_campaign_bucket', 'intake_lead_bucket',
  'intake_main_concern', 'intake_urgency', 'intake_new_old_status', 'intake_outcome',
  'service_type', 'branch', 'diabetes_status', 'gender',
  'lead_source', 'patient_type', 'lead_status',
  'appointment_status', 'confirmation_status', 'followup_outcome',
]

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function SettingsPage() {
  const [tab, setTab] = useState<'dropdowns' | 'schedules'>('dropdowns')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [options, setOptions] = useState<any[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [toast, setToast] = useState('')

  const [doctors, setDoctors] = useState<any[]>([])
  const [schedules, setSchedules] = useState<any[]>([])
  const [selectedDoctor, setSelectedDoctor] = useState('')

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function load() {
    const { data } = await supabase.from('dropdown_options').select('*').eq('category', category).order('sort_order')
    setOptions(data || [])
  }

  useEffect(() => { if (tab === 'dropdowns') load() }, [category, tab]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addOption() {
    if (!newLabel.trim()) return
    const value = newLabel.trim()
    const { error } = await supabase.from('dropdown_options').insert({ category, label: newLabel.trim(), value, sort_order: options.length + 1, active: true })
    if (error) { showToast('Failed: ' + error.message); return }
    setNewLabel('')
    showToast('Option added.')
    load()
  }

  async function toggleActive(id: string, active: boolean) {
    await supabase.from('dropdown_options').update({ active: !active }).eq('id', id)
    load()
  }

  async function removeOption(id: string) {
    if (!confirm('Remove this option permanently?')) return
    const { error } = await supabase.from('dropdown_options').delete().eq('id', id)
    if (error) { showToast('Failed: ' + error.message); return }
    showToast('Option removed.')
    load()
  }

  // --- Doctor schedules ---
  async function loadDoctors() {
    const { data } = await supabase.from('doctors').select('name').eq('is_active', true).order('name')
    setDoctors(data || [])
    if (data && data.length && !selectedDoctor) setSelectedDoctor(data[0].name)
  }

  async function loadSchedules(doctorName: string) {
    const { data } = await supabase.from('doctor_schedules').select('*').eq('doctor_name', doctorName).order('day_of_week')
    setSchedules(data || [])
  }

  useEffect(() => { if (tab === 'schedules') loadDoctors() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'schedules' && selectedDoctor) loadSchedules(selectedDoctor) }, [tab, selectedDoctor]) // eslint-disable-line react-hooks/exhaustive-deps

  function scheduleForDay(dow: number) {
    return schedules.find((s) => s.day_of_week === dow)
  }

  async function setDayActive(dow: number, isActive: boolean) {
    const existing = scheduleForDay(dow)
    if (existing) {
      await supabase.from('doctor_schedules').update({ is_active: isActive }).eq('id', existing.id)
    } else if (isActive) {
      await supabase.from('doctor_schedules').insert({ doctor_name: selectedDoctor, day_of_week: dow, start_time: '09:00', end_time: '21:00', is_active: true })
    }
    loadSchedules(selectedDoctor)
  }

  async function updateDayTime(dow: number, field: 'start_time' | 'end_time', value: string) {
    const existing = scheduleForDay(dow)
    if (existing) {
      await supabase.from('doctor_schedules').update({ [field]: value }).eq('id', existing.id)
    } else {
      await supabase.from('doctor_schedules').insert({
        doctor_name: selectedDoctor, day_of_week: dow, is_active: true,
        start_time: field === 'start_time' ? value : '09:00',
        end_time: field === 'end_time' ? value : '21:00',
      })
    }
    loadSchedules(selectedDoctor)
  }

  return (
    <div className="space-y-4 pb-20 max-w-2xl">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-slate-500">Manage dropdown options and doctor schedules used across the intake, appointment, and follow-up forms.</p>

      <div className="flex gap-2">
        <button onClick={() => setTab('dropdowns')} className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === 'dropdowns' ? 'bg-teal-600 text-white' : 'border border-slate-300 text-slate-600'}`}>Dropdown options</button>
        <button onClick={() => setTab('schedules')} className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === 'schedules' ? 'bg-teal-600 text-white' : 'border border-slate-300 text-slate-600'}`}>Doctor schedules</button>
      </div>

      {tab === 'dropdowns' && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </select>

          <ul className="divide-y divide-slate-100">
            {options.map((o) => (
              <li key={o.id} className="py-2 flex items-center justify-between text-sm gap-2">
                <span className={o.active ? '' : 'text-slate-400 line-through'}>{o.label}</span>
                <span className="flex gap-3">
                  <button onClick={() => toggleActive(o.id, o.active)} className="text-xs text-teal-700">
                    {o.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => removeOption(o.id)} className="text-xs text-rose-600">Remove</button>
                </span>
              </li>
            ))}
            {options.length === 0 && <li className="py-2 text-sm text-slate-400">No options yet.</li>}
          </ul>

          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <input className="input flex-1" placeholder="New option label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <button onClick={addOption} className="bg-teal-600 text-white px-4 py-2 rounded-md text-sm font-medium">Add</button>
          </div>
        </div>
      )}

      {tab === 'schedules' && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
          <select className="input" value={selectedDoctor} onChange={(e) => setSelectedDoctor(e.target.value)}>
            {doctors.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
          </select>

          <p className="text-xs text-slate-500">Only the checked days and hours will show as bookable appointment slots (15-minute increments) on the Lead Intake page.</p>

          <ul className="divide-y divide-slate-100">
            {DAYS.map((label, dow) => {
              const s = scheduleForDay(dow)
              const active = s?.is_active ?? false
              return (
                <li key={dow} className="py-2 flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-2 w-28">
                    <input type="checkbox" checked={active} onChange={(e) => setDayActive(dow, e.target.checked)} />
                    {label}
                  </label>
                  <input
                    type="time"
                    className="input w-28"
                    disabled={!active}
                    value={s?.start_time?.slice(0, 5) || '09:00'}
                    onChange={(e) => updateDayTime(dow, 'start_time', e.target.value)}
                  />
                  <span className="text-slate-400">to</span>
                  <input
                    type="time"
                    className="input w-28"
                    disabled={!active}
                    value={s?.end_time?.slice(0, 5) || '21:00'}
                    onChange={(e) => updateDayTime(dow, 'end_time', e.target.value)}
                  />
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {toast && <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-sm px-4 py-3 rounded-md shadow-lg">{toast}</div>}
    </div>
  )
}

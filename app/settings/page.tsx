'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const CATEGORIES = [
  'lead_source', 'patient_type', 'lead_status', 'diabetes_status', 'gender',
  'appointment_status', 'confirmation_status', 'followup_outcome',
]

export default function SettingsPage() {
  const [category, setCategory] = useState(CATEGORIES[0])
  const [options, setOptions] = useState<any[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [toast, setToast] = useState('')

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function load() {
    const { data } = await supabase.from('dropdown_options').select('*').eq('category', category).order('sort_order')
    setOptions(data || [])
  }

  useEffect(() => { load() }, [category]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addOption() {
    if (!newLabel.trim()) return
    const value = newLabel.trim().toLowerCase().replace(/\s+/g, '_')
    const { error } = await supabase.from('dropdown_options').insert({ category, label: newLabel.trim(), value, sort_order: options.length + 1 })
    if (error) { showToast('Failed: ' + error.message); return }
    setNewLabel('')
    showToast('Option added.')
    load()
  }

  async function toggleActive(id: string, active: boolean) {
    await supabase.from('dropdown_options').update({ active: !active }).eq('id', id)
    load()
  }

  return (
    <div className="space-y-4 pb-20 max-w-2xl">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-slate-500">Manage dropdown options used across the intake, appointment, and follow-up forms.</p>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </select>

        <ul className="divide-y divide-slate-100">
          {options.map((o) => (
            <li key={o.id} className="py-2 flex items-center justify-between text-sm">
              <span className={o.active ? '' : 'text-slate-400 line-through'}>{o.label}</span>
              <button onClick={() => toggleActive(o.id, o.active)} className="text-xs text-teal-700">
                {o.active ? 'Deactivate' : 'Activate'}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex gap-2 pt-2 border-t border-slate-100">
          <input className="input flex-1" placeholder="New option label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <button onClick={addOption} className="bg-teal-600 text-white px-4 py-2 rounded-md text-sm font-medium">Add</button>
        </div>
      </div>

      {toast && <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-sm px-4 py-3 rounded-md shadow-lg">{toast}</div>}
    </div>
  )
}

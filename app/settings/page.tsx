'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { useVisibilityReload } from '@/hooks/useVisibilityReload'

const CATEGORY_GROUPS: { section: string; items: { key: string; label: string }[] }[] = [
  {
    section: 'Lead Intake',
    items: [
      { key: 'intake_source_channel', label: 'Source Channel' },
      { key: 'intake_call_direction', label: 'Call Direction (Incoming/Outgoing)' },
      { key: 'intake_lead_bucket', label: 'Lead Bucket' },
      { key: 'intake_main_concern', label: 'Main Concern' },
      { key: 'intake_urgency', label: 'Urgency' },
      { key: 'intake_new_old_status', label: 'New / Old Status' },
      { key: 'intake_outcome', label: 'Intake Outcome' },
      { key: 'intake_no_appointment_reason', label: 'No Appointment Reason' },
      { key: 'diabetes_status', label: 'Diabetes Status' },
    ],
  },
  {
    section: 'Appointments',
    items: [
      { key: 'appointment_status', label: 'Appointment Status' },
      { key: 'confirmation_status', label: 'Confirmation Status' },
      { key: 'service_type', label: 'Service Type' },
      { key: 'branch', label: 'Branch' },
    ],
  },
  {
    section: 'Patients',
    items: [
      { key: 'gender', label: 'Gender' },
      { key: 'patient_type', label: 'Patient Type' },
    ],
  },
  {
    section: 'Leads & Calls',
    items: [
      { key: 'lead_source', label: 'Lead Source (legacy)' },
      { key: 'lead_status', label: 'Lead Status' },
      { key: 'followup_outcome', label: 'Follow-up Outcome' },
    ],
  },
]

const ALL_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.label]))
)

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type Selection = { kind: 'dropdown'; category: string } | { kind: 'doctorSchedules' } | { kind: 'agentSchedules' } | { kind: 'auditLog' }

export default function SettingsPage() {
  const router = useRouter()
  const { profile, isAdmin, loading: authLoading } = useAuth()

  // Settings (dropdowns, schedules, and the audit log below) is admin-only —
  // agents can still read this data elsewhere in the app, but can't manage it.
  useEffect(() => {
    if (!authLoading && profile && !isAdmin) router.replace('/')
  }, [authLoading, profile, isAdmin, router])

  const [selection, setSelection] = useState<Selection>({ kind: 'dropdown', category: CATEGORY_GROUPS[0].items[0].key })
  const [options, setOptions] = useState<any[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [toast, setToast] = useState('')

  const [doctors, setDoctors] = useState<any[]>([])
  const [schedules, setSchedules] = useState<any[]>([])
  const [selectedDoctor, setSelectedDoctor] = useState('')

  const [agents, setAgents] = useState<any[]>([])
  const [agentSchedules, setAgentSchedules] = useState<any[]>([])
  const [newAgentName, setNewAgentName] = useState('')

  // --- Audit log ---
  const [loginHistory, setLoginHistory] = useState<any[]>([])
  const [changeHistory, setChangeHistory] = useState<any[]>([])

  async function loadAuditLog() {
    const [{ data: logins }, { data: changes }] = await Promise.all([
      supabase.rpc('get_login_history', { p_limit: 100 }),
      supabase.from('data_change_audit_log').select('*').order('changed_at', { ascending: false }).limit(100),
    ])
    setLoginHistory(logins || [])
    setChangeHistory(changes || [])
  }

  useEffect(() => { if (selection.kind === 'auditLog') loadAuditLog() }, [selection]) // eslint-disable-line react-hooks/exhaustive-deps

  useVisibilityReload(() => {
    if (selection.kind === 'auditLog') loadAuditLog()
    else if (selection.kind === 'dropdown') load(selection.category)
  })

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  // --- Dropdown options ---
  async function load(category: string) {
    const { data } = await supabase.from('dropdown_options').select('*').eq('category', category).order('sort_order')
    setOptions(data || [])
  }

  useEffect(() => {
    if (selection.kind === 'dropdown') load(selection.category)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection])

  async function addOption() {
    if (selection.kind !== 'dropdown' || !newLabel.trim()) return
    const value = newLabel.trim()
    const { error } = await supabase.from('dropdown_options').insert({ category: selection.category, label: newLabel.trim(), value, sort_order: options.length + 1, active: true })
    if (error) { showToast('Failed: ' + error.message); return }
    setNewLabel('')
    showToast('Option added.')
    load(selection.category)
  }

  async function toggleActive(id: string, active: boolean) {
    await supabase.from('dropdown_options').update({ active: !active }).eq('id', id)
    if (selection.kind === 'dropdown') load(selection.category)
  }

  async function removeOption(id: string) {
    if (!confirm('Remove this option permanently?')) return
    const { error } = await supabase.from('dropdown_options').delete().eq('id', id)
    if (error) { showToast('Failed: ' + error.message); return }
    showToast('Option removed.')
    if (selection.kind === 'dropdown') load(selection.category)
  }

  const [csvUploading, setCsvUploading] = useState(false)

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

  useEffect(() => { if (selection.kind === 'doctorSchedules') loadDoctors() }, [selection]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (selection.kind === 'doctorSchedules' && selectedDoctor) loadSchedules(selectedDoctor) }, [selection, selectedDoctor]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // --- CSV weekly schedule upload/download ---
  // Format: Doctor, Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday
  // Each day cell is either blank/"off" (day off) or "HH:MM-HH:MM" (open hours).
  // Re-uploading each month corrects the schedule to match the new file —
  // every day cell present in the file overwrites whatever was there before.
  function splitCsvLine(line: string): string[] {
    // Minimal CSV split: handles simple quoted fields with commas inside.
    const cells: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQuotes = !inQuotes; continue }
      if (ch === ',' && !inQuotes) { cells.push(cur.trim()); cur = ''; continue }
      cur += ch
    }
    cells.push(cur.trim())
    return cells
  }

  function parseDayCell(cell: string): { start_time: string; end_time: string; is_active: boolean } {
    const v = cell.trim()
    if (!v || /^(off|closed|-|n\/a)$/i.test(v)) {
      return { start_time: '09:00', end_time: '21:00', is_active: false }
    }
    const m = v.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/)
    if (!m) return { start_time: '09:00', end_time: '21:00', is_active: false }
    return { start_time: m[1], end_time: m[2], is_active: true }
  }

  async function downloadScheduleTemplate() {
    const { data: docs } = await supabase.from('doctors').select('name').eq('is_active', true).order('name')
    const { data: allSchedules } = await supabase.from('doctor_schedules').select('*')
    const header = ['Doctor', ...DAYS]
    const lines = [header.join(',')]
    ;(docs || []).forEach((d: any) => {
      const cells = [d.name]
      for (let dow = 0; dow < 7; dow++) {
        const s = (allSchedules || []).find((x: any) => x.doctor_name === d.name && x.day_of_week === dow)
        if (s && s.is_active) cells.push(`${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)}`)
        else cells.push('OFF')
      }
      lines.push(cells.map((c) => `"${c}"`).join(','))
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'doctor-weekly-schedule.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleScheduleCsvUpload(file: File) {
    setCsvUploading(true)
    try {
      const text = await file.text()
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
      if (lines.length < 2) { showToast('CSV has no data rows.'); return }

      const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase())
      const dayCols = DAYS.map((d) => header.indexOf(d.toLowerCase()))
      if (dayCols.some((i) => i === -1)) {
        showToast('CSV header must include Doctor, Sunday, Monday, ... Saturday.')
        return
      }

      const rows: any[] = []
      for (const line of lines.slice(1)) {
        const cells = splitCsvLine(line)
        const doctorName = cells[0]
        if (!doctorName) continue
        DAYS.forEach((_, dow) => {
          const cell = cells[dayCols[dow]] || ''
          const parsed = parseDayCell(cell)
          rows.push({ doctor_name: doctorName, day_of_week: dow, ...parsed })
        })
      }

      if (rows.length === 0) { showToast('No valid rows found in CSV.'); return }

      const { data, error } = await supabase.rpc('bulk_upsert_doctor_schedules', { p_rows: rows })
      if (error) { showToast('Upload failed: ' + error.message); return }
      showToast(`Schedule updated — ${(data as any)?.rows_upserted ?? rows.length} day-entries applied.`)
      loadDoctors()
      if (selectedDoctor) loadSchedules(selectedDoctor)
    } catch (err: any) {
      showToast('Could not read file: ' + err.message)
    } finally {
      setCsvUploading(false)
    }
  }

  // --- Agent schedules ---
  async function loadAgents() {
    const { data } = await supabase.from('agents').select('*').eq('active', true).order('agent_name')
    setAgents(data || [])
  }

  async function loadAgentSchedules() {
    const { data } = await supabase.from('agent_schedules').select('*')
    setAgentSchedules(data || [])
  }

  useEffect(() => { if (selection.kind === 'agentSchedules') { loadAgents(); loadAgentSchedules() } }, [selection]) // eslint-disable-line react-hooks/exhaustive-deps

  function agentDayActive(agentName: string, dow: number) {
    return agentSchedules.find((s) => s.agent_name === agentName && s.day_of_week === dow)?.is_active ?? false
  }

  async function toggleAgentDay(agentName: string, dow: number, isActive: boolean) {
    const existing = agentSchedules.find((s) => s.agent_name === agentName && s.day_of_week === dow)
    if (existing) {
      await supabase.from('agent_schedules').update({ is_active: isActive }).eq('id', existing.id)
    } else {
      await supabase.from('agent_schedules').insert({ agent_name: agentName, day_of_week: dow, is_active: isActive })
    }
    loadAgentSchedules()
  }

  async function addAgent() {
    if (!newAgentName.trim()) return
    const { error } = await supabase.from('agents').insert({ agent_name: newAgentName.trim(), role: 'agent', active: true })
    if (error) { showToast('Failed: ' + error.message); return }
    setNewAgentName('')
    showToast('Agent added — set their days below.')
    loadAgents()
  }

  function SidebarButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
      <button
        onClick={onClick}
        className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors ${
          active ? 'bg-teal-600 text-white font-medium' : 'text-slate-600 hover:bg-slate-100'
        }`}
      >
        {children}
      </button>
    )
  }

  return (
    <div className="space-y-4 pb-20">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-slate-500">Manage the dropdown options and schedules used across every page.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4 items-start">
        {/* Sidebar */}
        <nav className="bg-white rounded-xl border border-slate-200 p-3 space-y-4">
          {CATEGORY_GROUPS.map((group) => (
            <div key={group.section}>
              <p className="text-xs font-semibold text-slate-400 uppercase px-3 mb-1">{group.section}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <SidebarButton
                    key={item.key}
                    active={selection.kind === 'dropdown' && selection.category === item.key}
                    onClick={() => setSelection({ kind: 'dropdown', category: item.key })}
                  >
                    {item.label}
                  </SidebarButton>
                ))}
              </div>
            </div>
          ))}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase px-3 mb-1">Schedules</p>
            <div className="space-y-0.5">
              <SidebarButton active={selection.kind === 'doctorSchedules'} onClick={() => setSelection({ kind: 'doctorSchedules' })}>
                Doctor Schedules
              </SidebarButton>
              <SidebarButton active={selection.kind === 'agentSchedules'} onClick={() => setSelection({ kind: 'agentSchedules' })}>
                Agent Schedules
              </SidebarButton>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase px-3 mb-1">Security</p>
            <div className="space-y-0.5">
              <SidebarButton active={selection.kind === 'auditLog'} onClick={() => setSelection({ kind: 'auditLog' })}>
                Audit Log
              </SidebarButton>
            </div>
          </div>
        </nav>

        {/* Panel */}
        <div>
          {selection.kind === 'dropdown' && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
              <h2 className="font-medium text-slate-700">{ALL_CATEGORY_LABELS[selection.category] || selection.category}</h2>

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

          {selection.kind === 'doctorSchedules' && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
              <h2 className="font-medium text-slate-700">Doctor Schedules</h2>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                <p className="text-xs font-medium text-slate-600">Bulk update from CSV</p>
                <p className="text-xs text-slate-500">
                  Upload a weekly schedule for all doctors at once — columns: Doctor, Sunday, Monday, Tuesday,
                  Wednesday, Thursday, Friday, Saturday. Each day cell is a time range like <code>09:00-21:00</code>,
                  or <code>OFF</code> for a day off. Re-upload each month to correct the schedule — every day in
                  the file replaces whatever was there before for that doctor.
                </p>
                <div className="flex flex-wrap gap-2 items-center pt-1">
                  <button onClick={downloadScheduleTemplate} className="text-xs px-3 py-1.5 border border-slate-300 rounded-md text-slate-600 hover:bg-white">
                    Download current schedule as CSV
                  </button>
                  <label className="text-xs px-3 py-1.5 bg-teal-600 text-white rounded-md font-medium cursor-pointer hover:bg-teal-700">
                    {csvUploading ? 'Uploading…' : 'Upload CSV'}
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      disabled={csvUploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleScheduleCsvUpload(file)
                        e.target.value = ''
                      }}
                    />
                  </label>
                </div>
              </div>

              <select className="input" value={selectedDoctor} onChange={(e) => setSelectedDoctor(e.target.value)}>
                {doctors.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              </select>

              <p className="text-xs text-slate-500">Only the checked days and hours will show as bookable appointment slots (15-minute increments) on the Lead Intake and Calendar reschedule panels.</p>

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

          {selection.kind === 'agentSchedules' && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
              <h2 className="font-medium text-slate-700">Agent Schedules</h2>
              <p className="text-xs text-slate-500">
                Check the days each agent is scheduled to make outgoing follow-up calls. The Outgoing Call queue
                auto-assigns each pending call to whichever agent(s) are active that day — rotating between them
                if more than one is checked — with no code changes needed.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left py-2 pr-3 font-medium text-slate-500">Agent</th>
                      {DAYS.map((d) => (
                        <th key={d} className="text-center py-2 px-1 font-medium text-slate-500 text-xs">{d.slice(0, 3)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {agents.map((a) => (
                      <tr key={a.id}>
                        <td className="py-2 pr-3 font-medium text-slate-700">{a.agent_name}</td>
                        {DAYS.map((_, dow) => (
                          <td key={dow} className="text-center py-2 px-1">
                            <input
                              type="checkbox"
                              checked={agentDayActive(a.agent_name, dow)}
                              onChange={(e) => toggleAgentDay(a.agent_name, dow, e.target.checked)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                    {agents.length === 0 && (
                      <tr><td colSpan={8} className="py-3 text-sm text-slate-400">No agents yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <input className="input flex-1" placeholder="New agent name" value={newAgentName} onChange={(e) => setNewAgentName(e.target.value)} />
                <button onClick={addAgent} className="bg-teal-600 text-white px-4 py-2 rounded-md text-sm font-medium">Add agent</button>
              </div>
            </div>
          )}

          {selection.kind === 'auditLog' && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <h2 className="font-medium text-slate-700">Sign-in History</h2>
                <p className="text-xs text-slate-500">Who logged in, and when — sourced directly from Supabase Auth.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-slate-400 uppercase">
                      <tr><th className="text-left px-2 py-1">When</th><th className="text-left px-2 py-1">Name</th><th className="text-left px-2 py-1">Email</th><th className="text-left px-2 py-1">Event</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loginHistory.map((r: any, i: number) => (
                        <tr key={i}>
                          <td className="px-2 py-1.5 whitespace-nowrap">{r.happened_at ? new Date(r.happened_at).toLocaleString() : '—'}</td>
                          <td className="px-2 py-1.5">{r.full_name || '—'}</td>
                          <td className="px-2 py-1.5 text-slate-500">{r.email || '—'}</td>
                          <td className="px-2 py-1.5">{r.event}</td>
                        </tr>
                      ))}
                      {loginHistory.length === 0 && <tr><td colSpan={4} className="py-3 text-sm text-slate-400">No sign-in events yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <h2 className="font-medium text-slate-700">Data Change History</h2>
                <p className="text-xs text-slate-500">Recent inserts/updates across patient, lead, and appointment records, with who made each change.</p>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-slate-400 uppercase sticky top-0 bg-white">
                      <tr><th className="text-left px-2 py-1">When</th><th className="text-left px-2 py-1">Table</th><th className="text-left px-2 py-1">Op</th><th className="text-left px-2 py-1">Row</th><th className="text-left px-2 py-1">Changed By</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {changeHistory.map((r: any) => (
                        <tr key={r.id}>
                          <td className="px-2 py-1.5 whitespace-nowrap">{r.changed_at ? new Date(r.changed_at).toLocaleString() : '—'}</td>
                          <td className="px-2 py-1.5">{r.table_name}</td>
                          <td className="px-2 py-1.5">{r.operation}</td>
                          <td className="px-2 py-1.5 text-slate-500">{r.row_pk}</td>
                          <td className="px-2 py-1.5">{r.changed_by || '—'}</td>
                        </tr>
                      ))}
                      {changeHistory.length === 0 && <tr><td colSpan={5} className="py-3 text-sm text-slate-400">No data changes logged yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {toast && <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-sm px-4 py-3 rounded-md shadow-lg">{toast}</div>}
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {useBookingDoctors} from '@/hooks/useDoctorBooking'
import { WEEKDAYS, type DoctorSession, doctorNameVariants, sessionValidation, parseScheduleCsv, scheduleCell } from '@/lib/doctor-schedule'

export default function DoctorSchedulesEditor() {
  const {doctors:directory,error:directoryError}=useBookingDoctors(true)
  const doctors=directory.map(d=>d.name)
  const [doctor, setDoctor] = useState('')
  const [draft, setDraft] = useState<DoctorSession[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(()=>{if(!doctor&&directory.length)setDoctor(directory[0].name)},[directory,doctor])

  useEffect(() => {
    if (!doctor) return
    let cancelled = false
    setLoading(true); setError(''); setMessage(''); setDraft([]); setDirty(false)
    supabase.from('doctor_schedules').select('*').in('doctor_name', doctorNameVariants(doctor)).order('day_of_week').order('start_time').then(({data,error}) => {
      if (cancelled) return
      if (error) setError('Could not load this schedule. Reload before making changes.')
      else setDraft((data || []).map(s => ({...s,start_time:s.start_time.slice(0,5),end_time:s.end_time.slice(0,5)})))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [doctor, reload])

  const change = (rows: DoctorSession[]) => { setDraft(rows); setDirty(true); setMessage(''); setError('') }
  const update = (index: number, field: 'start_time' | 'end_time', value: string) => change(draft.map((s,i) => i === index ? {...s,[field]:value} : s))
  const toggle = (day: number, active: boolean) => {
    const rows = draft.filter(s => s.day_of_week === day)
    change(rows.length ? draft.map(s => s.day_of_week === day ? {...s,is_active:active} : s) : [...draft,{day_of_week:day,start_time:'09:00',end_time:'17:00',slot_minutes:15,is_active:true}])
  }
  const add = (day: number) => {
    const rows = draft.filter(s => s.day_of_week === day && s.is_active !== false)
    const last = [...rows].sort((a,b)=>a.end_time.localeCompare(b.end_time)).at(-1)
    const hour = Math.min(22, Number(last?.end_time.slice(0,2) || 8) + 1)
    change([...draft,{day_of_week:day,start_time:`${String(hour).padStart(2,'0')}:00`,end_time:`${String(Math.min(23,hour+2)).padStart(2,'0')}:00`,slot_minutes:15,is_active:true}])
  }
  async function save() {
    const active = draft.filter(s => s.is_active !== false)
    const invalid = sessionValidation(active)
    if (invalid) { setError(invalid); return }
    const rows = WEEKDAYS.flatMap((_,day) => {
      const sessions = active.filter(s => s.day_of_week === day)
      return (sessions.length ? sessions : [{day_of_week:day,start_time:'09:00',end_time:'21:00',slot_minutes:15,is_active:false}]).map(s=>({...s,doctor_name:doctor}))
    })
    setSaving(true); setError(''); setMessage('')
    const {error} = await supabase.rpc('bulk_upsert_doctor_schedules',{p_rows:rows})
    setSaving(false)
    if (error) { setError(error.message); return }
    setDirty(false); setMessage('Schedule saved. Booking times now follow these sessions.')
    window.dispatchEvent(new Event('ekagra:refresh-reference-data'))
  }
  async function download() {
    const {data,error} = await supabase.from('doctor_schedules').select('*').order('start_time')
    if (error) { setError(error.message); return }
    const lines = [['Doctor',...WEEKDAYS],...doctors.map(name=>[name,...WEEKDAYS.map((_,day)=>scheduleCell((data || []).filter(s=>doctorNameVariants(name).includes(s.doctor_name)&&s.day_of_week===day)))])]
    const url = URL.createObjectURL(new Blob([lines.map(row=>row.map(c=>`"${c.replaceAll('"','""')}"`).join(',')).join('\n')],{type:'text/csv'}))
    const link = document.createElement('a'); link.href=url; link.download='doctor-weekly-schedule.csv'; link.click(); URL.revokeObjectURL(url)
  }
  async function upload(file: File) {
    setSaving(true); setError(''); setMessage('')
    try {
      const rows = parseScheduleCsv(await file.text())
      const {error} = await supabase.rpc('bulk_upsert_doctor_schedules',{p_rows:rows})
      if (error) throw error
      setReload(n=>n+1)
      window.dispatchEvent(new Event('ekagra:refresh-reference-data'))
    } catch (e) { setError(e instanceof Error ? e.message : String((e as {message?:string}).message || e)) }
    finally { setSaving(false) }
  }

  return <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 space-y-5">
    <div><h2 className="font-semibold text-slate-800">Doctor Schedules</h2><p className="mt-1 text-sm text-slate-500">Add separate sessions for each day. Breaks between sessions stay unavailable. All times are Bangladesh time.</p></div>
    <details className="rounded-lg border border-amber-200 bg-amber-50 p-3"><summary className="cursor-pointer text-sm font-medium">Unavailable for booking ({directory.filter(d=>!d.has_schedule).length})</summary><p className="mt-2 text-xs text-amber-900">Approved weekly hours are required before these entries can be booked.</p><ul className="mt-2 space-y-1 text-xs">{directory.filter(d=>!d.has_schedule).map(d=><li key={d.name}>{d.name} — {d.has_configured_schedule?'All sessions off':'Schedule missing'}</li>)}</ul></details>
    <label className="block text-sm font-medium text-slate-700">Doctor
      <select className="input mt-1" aria-label="Schedule doctor" value={doctor} disabled={saving} onChange={e=>{
        if (dirty && !window.confirm('Discard the unsaved schedule changes?')) return
        setDoctor(e.target.value)
      }}>{doctors.map(name=><option key={name} value={name}>{name}{directory.find(d=>d.name===name)?.has_schedule?'':' — Unavailable'}</option>)}</select>
    </label>
    {directoryError && <p role="alert" className="text-sm text-rose-700">{directoryError}</p>}
    {error && <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {message && <p role="status" className="rounded-md bg-teal-50 p-3 text-sm text-teal-800">{message}</p>}
    {loading ? <p className="text-sm text-slate-500">Loading schedule…</p> : <fieldset disabled={saving || !doctor || !!error && !dirty} className="min-w-0 divide-y divide-slate-100">
      {WEEKDAYS.map((name,day)=>{
        const sessions=draft.map((s,index)=>({...s,index})).filter(s=>s.day_of_week===day && s.is_active!==false)
        return <div key={day} className="py-4 sm:flex sm:items-start sm:gap-5">
          <label className="flex w-32 shrink-0 items-center gap-2 py-2 text-sm font-medium"><input type="checkbox" checked={sessions.length>0} onChange={e=>toggle(day,e.target.checked)} />{name}</label>
          <div className="min-w-0 flex-1 space-y-2">
            {sessions.length ? sessions.map((s,n)=><div key={s.index} className="flex flex-wrap items-center gap-2">
              <span className="w-16 text-xs text-slate-500">Session {n+1}</span>
              <input aria-label={`${name} session ${n+1} start`} type="time" className="rounded-md border border-slate-300 px-2 py-2 text-sm" value={s.start_time} onChange={e=>update(s.index,'start_time',e.target.value)} />
              <span className="text-xs text-slate-400">to</span>
              <input aria-label={`${name} session ${n+1} end`} type="time" className="rounded-md border border-slate-300 px-2 py-2 text-sm" value={s.end_time} onChange={e=>update(s.index,'end_time',e.target.value)} />
              <button type="button" aria-label={`Remove ${name} session ${n+1}`} className="px-2 py-2 text-xs text-rose-700 underline" onClick={()=>change(draft.filter((_,i)=>i!==s.index))}>Remove</button>
            </div>) : <p className="py-2 text-sm text-slate-400">Off</p>}
            {sessions.length>0 && <button type="button" className="min-h-9 rounded-md border border-teal-200 px-3 text-xs font-medium text-teal-800 hover:bg-teal-50" onClick={()=>add(day)}>+ Add session</button>}
          </div>
        </div>
      })}
    </fieldset>}
    <div className="flex flex-wrap items-center gap-3 border-t pt-4">
      <button type="button" disabled={loading||saving||!dirty} onClick={save} className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving?'Saving…':'Save schedule'}</button>
      <span className="text-xs text-slate-500">{dirty?'Unsaved changes':'Bookable slots use each session’s configured interval (normally 15 minutes).'}</span>
    </div>
    <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <summary className="cursor-pointer text-sm font-medium">Bulk update from CSV</summary>
      <p className="my-3 text-xs text-slate-500">Columns: Doctor, Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday. Separate sessions with a semicolon: <code>14:00-16:00;18:00-20:00</code>. Use OFF for closed days. Upload replaces the listed doctors’ weekly schedules.</p>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={saving||dirty} onClick={download} className="rounded-md border px-3 py-2 text-xs">Download current schedule as CSV</button>
        <label className={`rounded-md bg-teal-700 px-3 py-2 text-xs text-white ${saving||dirty?'opacity-50':'cursor-pointer'}`}>Upload CSV<input aria-label="Upload weekly schedule CSV" type="file" accept=".csv,text/csv" className="hidden" disabled={saving||dirty} onChange={e=>{const file=e.target.files?.[0];if(file)upload(file);e.target.value=''}} /></label></div>
    </details>
  </section>
}

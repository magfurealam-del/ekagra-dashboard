'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { displayDate } from '@/lib/dashboard-presentation'
import { APPOINTMENT_STATUSES, doctorReportCsv, filterDoctorPatients, summarizeDoctorPatients, type DoctorPatientReport } from '@/lib/doctor-patient-report'

const tones: Record<string,string> = { Booked:'bg-sky-50 text-sky-800', Confirmed:'bg-teal-50 text-teal-800', Completed:'bg-emerald-50 text-emerald-800', 'No-show':'bg-rose-50 text-rose-800', Rescheduled:'bg-violet-50 text-violet-800', Cancelled:'bg-slate-100 text-slate-700', Other:'bg-amber-50 text-amber-800', 'Not interested':'bg-orange-50 text-orange-800' }
const PAGE_SIZE = 25
export function DoctorPatients({start,end,reloadKey}:{start:string;end:string;reloadKey:number}) {
  const [report,setReport] = useState<DoctorPatientReport|null>(null)
  const [error,setError] = useState('')
  const [retry,setRetry] = useState(0)
  const [doctor,setDoctor] = useState('')
  const [status,setStatus] = useState('')
  const [search,setSearch] = useState('')
  const [page,setPage] = useState(1)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(),30000)
    setReport(null); setError(''); setPage(1)
    Promise.resolve(supabase.rpc('get_doctor_patient_report',{p_start_date:start,p_end_date:end}).abortSignal(controller.signal))
      .then(({data,error}) => {
        if (!active) return
        if (error) throw error
        if (data?.version !== 1 || !Array.isArray(data.records)) throw new Error('The doctor report is unavailable.')
        setReport(data)
      }).catch((e: {message?:string}) => { if (active) setError(e.message || 'The request timed out. Please retry.') })
      .finally(() => window.clearTimeout(timeout))
    return () => {active=false;controller.abort();window.clearTimeout(timeout)}
  },[start,end,reloadKey,retry])
  const records = report?.records
  const doctors = useMemo(() => [...new Set(records?.map(r=>r.doctor) ?? [])].sort(),[records])
  const selected = useMemo(() => (records ?? []).filter(r=>!doctor || r.doctor===doctor),[records,doctor])
  const summary = useMemo(() => summarizeDoctorPatients(selected),[selected])
  const doctorRows = useMemo(() => doctors.map(name=>({name,...summarizeDoctorPatients((records ?? []).filter(r=>r.doctor===name))})).sort((a,b)=>b.total-a.total || a.name.localeCompare(b.name)),[records,doctors])
  const filtered = useMemo(() => filterDoctorPatients(records ?? [],doctor,status,search),[records,doctor,status,search])
  const pages = Math.max(1,Math.ceil(filtered.length/PAGE_SIZE))
  function chooseDoctor(value:string) {setDoctor(value);setPage(1)}
  function chooseStatus(value:string) {setStatus(value);setPage(1)}
  function exportCsv() {
    const url=URL.createObjectURL(new Blob(['\uFEFF'+doctorReportCsv(filtered)],{type:'text/csv;charset=utf-8;'}))
    const a=document.createElement('a');a.href=url;a.download=`doctor-patients-${start}-${end}.csv`;a.click();URL.revokeObjectURL(url)
  }
  if (error) return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5"><p>{error}</p><Button onClick={()=>setRetry(v=>v+1)} className="mt-3">Retry doctor report</Button></div>
  if (!report) return <div role="status" className="rounded-xl border bg-white p-8 text-slate-600">Loading doctor summaries and patient details…</div>
  return <section className="space-y-5" aria-label="Doctor patient report">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><h2 className="text-2xl font-semibold tracking-tight">Doctor patients</h2><p className="mt-1 text-sm text-slate-600">See who booked, who confirmed, and what happened to each appointment.</p></div>
      <label className="text-sm font-medium">Doctor or service<select aria-label="Report doctor or service" value={doctor} onChange={e=>chooseDoctor(e.target.value)} className="mt-1 block h-11 w-full max-w-full rounded-lg border bg-white px-3 sm:w-80"><option value="">All doctors and services</option>{doctors.map(d=><option key={d}>{d}</option>)}</select></label>
    </div>
    <div className="rounded-xl border border-teal-100 bg-teal-50/50 p-4 text-sm text-slate-700">
      <p><strong>{displayDate(start)} – {displayDate(end)}</strong> · Appointments use the scheduled visit date, including future dates in the selected month. Statuses reflect the latest CRM record.</p>
      <p className="mt-1 text-xs">Live read {new Date(report.read_at).toLocaleString('en-GB',{timeZone:'Asia/Dhaka'})} BDT. Completed means CRM marked completed; it is not an invoice-verified attendance measure.</p>
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[{label:'All bookings',value:summary.total,detail:'Includes rescheduled and cancelled records',filter:''},{label:'Unique patients / leads',value:summary.patients,detail:'Linked patient ID, then lead ID; no phone guessing'},{label:'Confirmed',value:summary.counts.Confirmed,detail:'Open bookings with confirmation recorded',filter:'Confirmed'},{label:'Not interested',value:summary.declined,detail:'People with a recorded decline during this period',filter:'Not interested'}].map(item=><div key={item.label} className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-600">{item.label}</p>{item.filter!==undefined?<button onClick={()=>chooseStatus(item.filter!)} className="mt-2 text-3xl font-semibold text-teal-800 underline-offset-4 hover:underline" aria-label={`Show ${item.label.toLowerCase()}`}>{item.value.toLocaleString()}</button>:<p className="mt-2 text-3xl font-semibold">{item.value.toLocaleString()}</p>}<p className="mt-2 text-xs leading-relaxed text-slate-500">{item.detail}</p></div>)}
    </div>
    {summary.unlinked>0 && <p className="text-sm text-amber-800">{summary.unlinked} booking records have no patient or lead link and are counted separately in the identity total.</p>}
    <details className="rounded-xl border bg-white" open={!doctor || undefined}>
      <summary className="cursor-pointer p-4 font-semibold">Doctor summary · {doctorRows.length} doctors and services</summary>
      <p className="px-4 pb-3 text-xs text-slate-600">Select a doctor or a status count to open its patient list. Appointment status columns add up to All bookings. Not interested is separate and may overlap with bookings.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Appointments by doctor and current status for the selected period</caption><thead className="bg-slate-50 text-xs text-slate-600"><tr><th scope="col" className="p-3 text-left">Doctor / service</th>{['All bookings',...APPOINTMENT_STATUSES,'Not interested'].map(s=><th scope="col" key={s} className="whitespace-nowrap p-3 text-right">{s}</th>)}</tr></thead><tbody>{doctorRows.map(row=><tr key={row.name} className={`border-t ${doctor===row.name?'bg-teal-50':'hover:bg-slate-50'}`}><th scope="row" className="min-w-56 p-3 text-left font-medium"><button className="text-teal-800 hover:underline" onClick={()=>{chooseDoctor(row.name);chooseStatus('')}}>{row.name}</button></th>{[{key:'',value:row.total},...APPOINTMENT_STATUSES.map(s=>({key:s,value:row.counts[s]})),{key:'Not interested',value:row.declined}].map(c=><td key={c.key} className="p-3 text-right tabular-nums"><button className="min-h-8 min-w-8 rounded px-1 hover:bg-teal-100" aria-label={`${row.name}: ${c.key || 'All bookings'}, ${c.value}`} onClick={()=>{chooseDoctor(row.name);chooseStatus(c.key)}}>{c.value}</button></td>)}</tr>)}</tbody></table></div>
      {!doctorRows.length && <p className="p-5 text-sm text-slate-600">No records in this period.</p>}
    </details>
    <div className="rounded-xl border bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">{doctor || 'All doctors and services'} · Patient details</h3><p className="mt-1 text-xs text-slate-600">{status==='Not interested'?'One row per linked person and doctor; latest not-interested record in the period.':'One row per appointment. Rescheduled originals and replacement appointments are separate records.'}</p></div><Button variant="outline" disabled={!filtered.length} onClick={exportCsv}>Export filtered CSV ({filtered.length})</Button></div>
      <div className="my-4 flex flex-wrap gap-3"><label className="min-w-48 flex-1 text-xs font-medium text-slate-600">Search patients<Input aria-label="Search doctor patients" placeholder="Name, phone, hospital ID, HN or record ID" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} className="mt-1 h-10"/></label><label className="text-xs font-medium text-slate-600">Status<select aria-label="Patient report status" className="mt-1 block h-10 rounded-lg border bg-white px-3 text-sm" value={status} onChange={e=>chooseStatus(e.target.value)}><option value="">All appointment statuses</option>{[...APPOINTMENT_STATUSES,'Not interested'].map(s=><option key={s}>{s}</option>)}</select></label></div>
      <div className="mb-3 flex flex-wrap gap-2">{APPOINTMENT_STATUSES.map(s=><button key={s} aria-pressed={status===s} onClick={()=>chooseStatus(status===s?'':s)} className={`rounded-full border px-3 py-2 text-xs ${status===s?'ring-2 ring-teal-600': ''} ${tones[s]}`}>{s} · {summary.counts[s]}</button>)}</div>
      {status==='Not interested' && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">Not interested uses the call date in Bangladesh time. Legacy lead-only entries use lead creation date and are labelled explicitly. A decline may precede a later booking. Missing doctor associations stay under “Doctor not recorded”; no attribution is inferred from an unrelated visit.</p>}
      <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Filtered patient records</caption><thead className="border-y bg-slate-50 text-left text-xs text-slate-600"><tr>{['Patient','Doctor / service','Date & time','Status / confirmation','Record & follow-up'].map(h=><th scope="col" key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).map(r=><tr key={r.record_id} className="border-b align-top"><td className="min-w-48 p-3"><p className="font-medium">{r.patient_name}</p><p className="mt-1 text-slate-600">{r.phone || 'Phone not recorded'}</p><p className="mt-1 text-xs text-slate-500">{r.hospital_patient_id?`ID ${r.hospital_patient_id}`:r.hn?`HN ${r.hn}`:r.patient_id?`Patient #${r.patient_id}`:r.lead_id?`Lead #${r.lead_id}`:'Identity unlinked'}</p>{r.area && <p className="text-xs text-slate-500">{r.area}</p>}</td><td className="min-w-44 p-3"><p>{r.doctor}</p><p className="mt-1 text-xs text-slate-500">{r.service_type || r.evidence}</p></td><td className="min-w-36 p-3"><p className="whitespace-nowrap">{displayDate(r.report_date)}</p><p>{r.appointment_time || (r.recorded_at?new Date(r.recorded_at).toLocaleTimeString('en-GB',{timeZone:'Asia/Dhaka',hour:'2-digit',minute:'2-digit'}):'—')} BDT</p><p className="mt-1 text-xs text-slate-500">{r.date_basis}</p></td><td className="min-w-40 p-3"><span className={`inline-block rounded-md px-2 py-1 text-xs font-medium ${tones[r.status]}`}>{r.status}</span>{r.confirmation_status && <p className="mt-2 text-xs text-slate-500">Confirmation: {r.confirmation_status}</p>}{r.raw_status && r.raw_status!==r.status && <p className="mt-1 text-xs text-slate-500">Recorded status: {r.raw_status}</p>}</td><td className="min-w-48 p-3 text-xs text-slate-600"><p>{r.appointment_id?`Appointment #${r.appointment_id}`:r.record_id}</p><p className="mt-1">Agent: {r.agent || 'Not recorded'}</p>{r.previous_appointment_id && <p className="mt-1">From #{r.previous_appointment_id}</p>}{r.rescheduled_to_appointment_id && <p className="mt-1 text-violet-800">Moved to #{r.rescheduled_to_appointment_id}<br/>{r.replacement_date?displayDate(r.replacement_date):'Date unavailable'} {r.replacement_time || ''}</p>}</td></tr>)}</tbody></table></div>
      {!filtered.length && <div className="py-10 text-center text-sm text-slate-500">No matching patient records. Try another doctor, status, search or period.</div>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><p aria-live="polite" className="text-slate-600">{filtered.length?`${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE,filtered.length)} of ${filtered.length} records`:'0 records'}</p><div className="flex items-center gap-3"><Button variant="outline" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous patients</Button><span>Page {page} of {pages}</span><Button variant="outline" disabled={page>=pages} onClick={()=>setPage(p=>p+1)}>Next patients</Button></div></div>
    </div>
    <details className="rounded-xl border bg-white p-4 text-sm text-slate-600"><summary className="cursor-pointer font-medium text-slate-800">How to read this report</summary><ul className="mt-3 list-disc space-y-2 pl-5"><li>Booked includes Scheduled and Pending records that are not confirmed. Confirmed includes open bookings with confirmation recorded. Completed, No-show, Rescheduled and Cancelled take precedence over an earlier confirmation.</li><li>The report shows the latest status, not the number of status changes during the month. No-show is an explicit CRM status; it is never assumed just because an invoice is missing.</li><li>All bookings includes cancelled and rescheduled originals. The calendar’s active appointment total may therefore be lower. Patient totals use explicit links; one person may appear under multiple doctors.</li><li>Known doctor aliases are combined. Services and names without a verified match remain separate. Call outcomes without a doctor remain visible under Doctor not recorded.</li></ul></details>
  </section>
}

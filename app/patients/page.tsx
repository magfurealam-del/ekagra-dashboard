'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function PatientListPage() {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    let q = supabase.from('patient_master_view').select('*').order('last_appointment_date', { ascending: false, nullsFirst: false })
    if (query) {
      q = q.or(`patient_name.ilike.%${query}%,phone.ilike.%${query}%,hospital_patient_id.ilike.%${query}%`)
    }
    const { data, error } = await q.limit(200)
    if (!error && data) setRows(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('patient-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_appointments' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-4 pb-20">
      <h1 className="text-2xl font-semibold">Patient List</h1>

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex gap-2">
        <input
          className="input flex-1"
          placeholder="Search by name, phone, or hospital ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <button onClick={load} className="bg-teal-600 text-white px-4 py-2 rounded-md text-sm font-medium">Search</button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        {loading ? (
          <p className="p-4 text-sm text-slate-500">Loading…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Phone</th>
                <th className="text-left px-3 py-2">Hospital ID</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Area</th>
                <th className="text-left px-3 py-2">Last appt</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Total appts</th>
                <th className="text-left px-3 py-2">No-shows</th>
                <th className="text-left px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.patient_id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{r.patient_name}</td>
                  <td className="px-3 py-2">{r.phone}</td>
                  <td className="px-3 py-2">{r.hospital_patient_id || '—'}</td>
                  <td className="px-3 py-2">{r.patient_type || '—'}</td>
                  <td className="px-3 py-2">{r.area || '—'}</td>
                  <td className="px-3 py-2">{r.last_appointment_date || '—'}</td>
                  <td className="px-3 py-2">{r.last_appointment_status || '—'}</td>
                  <td className="px-3 py-2">{r.total_appointments}</td>
                  <td className="px-3 py-2">{r.no_show_count}</td>
                  <td className="px-3 py-2">
                    <Link href={`/patients/${r.patient_id}`} className="text-teal-700 text-xs font-medium">View profile</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

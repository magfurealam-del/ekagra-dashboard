'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { withRetry } from '@/lib/withTimeout'
import { useVisibilityReload } from '@/hooks/useVisibilityReload'

const patientsCache: { data: any[]; fetchedAt: number } = { data: [], fetchedAt: 0 }
const PATIENTS_TTL_MS = 30 * 60 * 1000

const DHAKA_AREAS = new Set([
  'Dhaka','Dhanmondi','Mirpur','Mohammadpur','Old Dhaka','Uttara','Khilgaon',
  'New Market','Cantonment','Demra','Keraniganj','Nawabganj','Dohar','Savar',
  'Tejgaon','Gulshan','Banani','Badda','Jatrabari','Motijheel','Ramna','Lalbagh',
  'Shyampur','Kafrul','Pallabi','Kotwali','Sutrapur','Wari','Mohakhali','Rampura',
  'Malibagh','Bashundhara','Baridhara','Shyamoli','Adabor','Kallyanpur',
  'Kamrangirchar','Hazaribagh',
])

const DHAKA_STYLES: Record<string, string> = {
  'Dhaka': 'bg-teal-100 text-teal-700',
  'Outside Dhaka': 'bg-orange-100 text-orange-700',
}

function dhakaStatus(area: string | null): string | null {
  if (!area) return null
  return DHAKA_AREAS.has(area) ? 'Dhaka' : 'Outside Dhaka'
}

type Column = { key: string; label: string; sortable?: boolean }

const COLUMNS: Column[] = [
  { key: 'full_name', label: 'Name', sortable: true },
  { key: 'phone', label: 'Phone', sortable: true },
  { key: 'hospital_id', label: 'Hospital ID', sortable: true },
  { key: 'patient_type', label: 'Type', sortable: true },
  { key: 'area', label: 'Area', sortable: true },
  { key: 'dhaka_status', label: 'Location', sortable: true },
  { key: 'created_at', label: 'Registered', sortable: true },
]

export default function PatientListPage() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function load(force = false) {
    const useCache = !query && !force && patientsCache.fetchedAt > 0 && Date.now() - patientsCache.fetchedAt < PATIENTS_TTL_MS
    if (useCache) {
      setRows(patientsCache.data)
      setLoading(false)
      return
    }
    setLoading(true)
    let q = supabase
      .from('patients')
      .select('id, full_name, phone, hn, hospital_patient_id, patient_type, area, created_at')
    if (query) {
      q = q.or(`full_name.ilike.%${query}%,phone.ilike.%${query}%,hn.ilike.%${query}%,hospital_patient_id.ilike.%${query}%`)
    }
    try {
      const { data, error } = await withRetry(() => q.order('created_at', { ascending: false }).limit(300), 15000, 2)
      if (!error && data) {
        const mapped = data.map((r: any) => ({
          ...r,
          hospital_id: r.hn || r.hospital_patient_id || null,
          dhaka_status: dhakaStatus(r.area),
        }))
        setRows(mapped)
        if (!query) {
          patientsCache.data = mapped
          patientsCache.fetchedAt = Date.now()
        }
      }
    } catch (err) {
      console.error('[patients] load failed', err)
      setRows([])
    }
    setLoading(false)
  }

  useVisibilityReload(() => load(true))

  useEffect(() => {
    load()
    const channel = supabase
      .channel('patient-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, () => {
        if (refreshTimer.current) clearTimeout(refreshTimer.current)
        refreshTimer.current = setTimeout(() => { load(true) }, 350)
      })
      .subscribe()
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av
      const as = String(av).toLowerCase(), bs = String(bv).toLowerCase()
      if (as < bs) return sortDir === 'asc' ? -1 : 1
      if (as > bs) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return copy
  }, [rows, sortKey, sortDir])

  return (
    <div className="space-y-4 pb-20">
      <div>
        <h1 className="text-2xl font-semibold">Patient List</h1>
        <p className="text-sm text-slate-500">{rows.length > 0 && !loading ? `${rows.length} patients` : 'All registered patients'}</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex gap-2">
        <input
          className="input flex-1"
          placeholder="Search by name, phone, or hospital ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <button onClick={() => load()} className="bg-teal-600 text-white px-4 py-2 rounded-md text-sm font-medium">Search</button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        {loading ? (
          <p className="p-4 text-sm text-slate-500">Loading…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    className={`px-3 py-2 select-none text-left ${col.sortable ? 'cursor-pointer hover:text-slate-700' : ''}`}
                    onClick={() => col.sortable && toggleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {col.sortable && sortKey === col.key && (
                        <span className="text-teal-600">{sortDir === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => router.push(`/patients/${r.id}`)}
                >
                  <td className="px-3 py-2 font-medium">{r.full_name}</td>
                  <td className="px-3 py-2">{r.phone}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.hospital_id || '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{r.patient_type || '—'}</td>
                  <td className="px-3 py-2">{r.area || '—'}</td>
                  <td className="px-3 py-2">
                    {r.dhaka_status ? (
                      <span className={`text-xs rounded px-1.5 py-0.5 ${DHAKA_STYLES[r.dhaka_status] || 'bg-slate-100 text-slate-600'}`}>
                        {r.dhaka_status}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
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

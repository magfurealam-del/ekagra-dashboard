'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { withRetry } from '@/lib/withTimeout'

const CATEGORY_STYLES: Record<string, string> = {
  'Wound Care': 'bg-rose-100 text-rose-700',
  'Screening': 'bg-amber-100 text-amber-700',
  'Consultancy': 'bg-sky-100 text-sky-700',
  'General': 'bg-slate-100 text-slate-600',
}

const DHAKA_STYLES: Record<string, string> = {
  'Dhaka': 'bg-teal-100 text-teal-700',
  'Outside Dhaka': 'bg-orange-100 text-orange-700',
}

type Column = {
  key: string
  label: string
  sortable?: boolean
  align?: 'left' | 'right'
}

const COLUMNS: Column[] = [
  { key: 'patient_name', label: 'Name', sortable: true },
  { key: 'phone', label: 'Phone', sortable: true },
  { key: 'hospital_id', label: 'Hospital ID', sortable: true },
  { key: 'patient_category', label: 'Category', sortable: true },
  { key: 'area', label: 'Area', sortable: true },
  { key: 'dhaka_status', label: 'Location', sortable: true },
  { key: 'first_visit_date', label: 'First visit', sortable: true },
  { key: 'last_visit_date', label: 'Last visit', sortable: true },
  { key: 'total_visits', label: 'Total visits', sortable: true, align: 'right' },
]

export default function PatientListPage() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState('last_visit_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  async function load() {
    setLoading(true)
    let q = supabase.from('patient_master_view').select('patient_id, patient_name, phone, hospital_id, patient_category, area, dhaka_status, first_visit_date, last_visit_date, total_visits')
    if (query) {
      q = q.or(`patient_name.ilike.%${query}%,phone.ilike.%${query}%,hospital_id.ilike.%${query}%`)
    }
    try {
      const { data, error } = await withRetry(() => q.limit(200), 10000, 1)
      if (!error && data) setRows(data)
    } catch (error) {
      console.error('[patients] load failed', error)
      setRows([])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('patient-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      const as = String(av).toLowerCase()
      const bs = String(bv).toLowerCase()
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
        <p className="text-sm text-slate-500">Visit history sourced from validated invoices</p>
      </div>

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
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    className={`px-3 py-2 select-none ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.sortable ? 'cursor-pointer hover:text-slate-700' : ''}`}
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
                  key={r.patient_id}
                  className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => router.push(`/patients/${r.patient_id}`)}
                >
                  <td className="px-3 py-2 font-medium">{r.patient_name}</td>
                  <td className="px-3 py-2">{r.phone}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.hospital_id || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs rounded px-1.5 py-0.5 ${CATEGORY_STYLES[r.patient_category] || 'bg-slate-100 text-slate-600'}`}>
                      {r.patient_category || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2">{r.area || '—'}</td>
                  <td className="px-3 py-2">
                    {r.dhaka_status ? (
                      <span className={`text-xs rounded px-1.5 py-0.5 ${DHAKA_STYLES[r.dhaka_status] || 'bg-slate-100 text-slate-600'}`}>
                        {r.dhaka_status}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2">{r.first_visit_date || '—'}</td>
                  <td className="px-3 py-2">{r.last_visit_date || '—'}</td>
                  <td className="px-3 py-2 text-right">{r.total_visits ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

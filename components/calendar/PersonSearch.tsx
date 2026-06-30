'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ViewMode } from './ViewModeTabs'

type Option = { id: string | number; label: string; sublabel?: string }

export default function PersonSearch({
  viewMode,
  selectedLabel,
  onSelect,
  onClear,
}: {
  viewMode: ViewMode
  selectedLabel: string | null
  onSelect: (id: string | number, label: string) => void
  onClear: () => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<Option[]>([])
  const [allDoctors, setAllDoctors] = useState<Option[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Doctors are a small fixed-ish set — fetch distinct values once per mode activation.
  useEffect(() => {
    if (viewMode !== 'doctor') return
    let cancelled = false
    supabase
      .from('doctor_visit_summary')
      .select('doctor_service')
      .then(({ data }) => {
        if (cancelled || !data) return
        const uniq = Array.from(
          new Set(data.map((r: any) => r.doctor_service ?? 'Unassigned'))
        ).sort()
        setAllDoctors(uniq.map((d) => ({ id: d, label: d })))
      })
    return () => {
      cancelled = true
    }
  }, [viewMode])

  useEffect(() => {
    if (viewMode === 'aggregate') return

    if (viewMode === 'doctor') {
      const q = query.toLowerCase()
      setOptions(
        q ? allDoctors.filter((o) => o.label.toLowerCase().includes(q)) : allDoctors
      )
      return
    }

    // patient mode — debounced search, min 2 chars
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 2) {
      setOptions([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('patient_visit_summary')
        .select('patient_id, full_name, phone, hn')
        .ilike('full_name', `%${query.trim()}%`)
        .limit(10)
      setOptions(
        (data || []).map((p: any) => ({
          id: p.patient_id,
          label: p.full_name,
          sublabel: [p.phone, p.hn].filter(Boolean).join(' · '),
        }))
      )
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, viewMode, allDoctors])

  if (viewMode === 'aggregate') return null

  return (
    <div className="relative w-64">
      <input
        className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        placeholder={viewMode === 'patient' ? 'Search patient…' : 'Search doctor…'}
        value={open ? query : selectedLabel || ''}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {selectedLabel && !open && (
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
          onMouseDown={(e) => {
            e.preventDefault()
            onClear()
          }}
        >
          ✕
        </button>
      )}
      {open && options.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg text-sm">
          {options.map((o) => (
            <li
              key={o.id}
              className="px-3 py-2 hover:bg-teal-50 cursor-pointer"
              onMouseDown={() => {
                onSelect(o.id, o.label)
                setOpen(false)
              }}
            >
              <div>{o.label}</div>
              {o.sublabel && <div className="text-xs text-slate-400">{o.sublabel}</div>}
            </li>
          ))}
        </ul>
      )}
      {open && viewMode === 'patient' && query.trim().length >= 2 && options.length === 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg text-sm px-3 py-2 text-slate-400">
          No matches
        </div>
      )}
    </div>
  )
}

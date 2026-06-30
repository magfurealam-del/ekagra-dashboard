'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Filter = { patientId?: string | number | null; doctorService?: string | null }

const STATUS_BADGE: Record<string, string> = {
  Completed: 'bg-emerald-100 text-emerald-700',
  'No-show': 'bg-amber-100 text-amber-700',
  Pending: 'bg-sky-100 text-sky-700',
  Cancelled: 'bg-slate-200 text-slate-500',
  Rescheduled: 'bg-slate-200 text-slate-500',
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function DayDrawer({
  date,
  filter,
  onClose,
}: {
  date: string
  filter?: Filter
  onClose: () => void
}) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    async function load() {
      let q = supabase
        .from('day_detail_appointments_view')
        .select('*')
        .eq('appointment_date', date)
        .order('appointment_time')
      if (filter?.patientId != null) q = q.eq('patient_id', filter.patientId)
      if (filter?.doctorService != null) q = q.eq('doctor_service', filter.doctorService)
      const { data } = await q
      if (!cancelled) {
        setRows(data || [])
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [date, filter?.patientId, filter?.doctorService])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-[480px] h-full bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="font-medium text-slate-800">{formatDate(date)}</h3>
            <p className="text-xs text-slate-400">
              {loading ? 'Loading…' : `${rows.length} appointment${rows.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none px-2 py-1"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-20 rounded-md bg-slate-100 animate-pulse" />
              ))}
            </div>
          )}

          {!loading && rows.length === 0 && (
            <p className="text-sm text-slate-400">No appointments on this day.</p>
          )}

          {!loading &&
            rows.map((a) => (
              <div key={a.appointment_id} className="border border-slate-200 rounded-md p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-800">
                    {a.appointment_time} · {a.doctor_service ?? 'Unassigned'}
                  </span>
                  <div className="flex items-center gap-1">
                    {a.validated_status === 'Completed' && a.matched_admission_an && (
                      <span className="text-[10px] rounded px-1.5 py-0.5 bg-slate-100 text-slate-500">
                        Invoice {a.matched_admission_an}
                      </span>
                    )}
                    <span
                      className={`text-[10px] rounded px-1.5 py-0.5 font-medium ${
                        STATUS_BADGE[a.validated_status] ?? 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {a.validated_status}
                    </span>
                  </div>
                </div>

                <div className="text-sm text-slate-700">
                  {a.patient_name}
                  {a.phone ? ` · ${a.phone}` : ''}
                  {a.patient_hn ? ` · HN ${a.patient_hn}` : ''}
                </div>

                <div className="text-xs text-slate-500">
                  {a.total_visits != null ? (
                    <>
                      Total visits: {a.total_visits}
                      {a.last_visit_date ? ` · Last visit: ${a.last_visit_date}` : ''}
                      {a.next_appointment_date
                        ? ` · Next: ${a.next_appointment_date}${
                            a.next_appointment_doctor ? ` with ${a.next_appointment_doctor}` : ''
                          }`
                        : ''}
                    </>
                  ) : (
                    'No prior visits — never invoice-validated'
                  )}
                </div>

                {(a.main_problem || a.notes) && (
                  <div className="text-xs text-slate-600">{a.main_problem || a.notes}</div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <div className="text-[11px] text-slate-400">
                    {[a.lead_source, a.agent_name].filter(Boolean).join(' · ')}
                  </div>
                  {a.validated_status === 'No-show' && a.phone && (
                    <a
                      href={`tel:${a.phone}`}
                      className="text-xs text-teal-700 hover:text-teal-800 font-medium"
                    >
                      Call patient
                    </a>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

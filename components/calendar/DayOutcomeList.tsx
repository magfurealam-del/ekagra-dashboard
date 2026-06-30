'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Props = {
  date: string
}

const STATUS_BADGE: Record<string, string> = {
  Completed: 'bg-emerald-100 text-emerald-700',
  'No-show': 'bg-amber-100 text-amber-700',
}

export default function DayOutcomeList({ date }: Props) {
  const [rows, setRows] = useState<any[]>([])
  const [queueStatus, setQueueStatus] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('day_detail_appointments_view')
      .select('*')
      .eq('appointment_date', date)
      .in('validated_status', ['Completed', 'No-show'])
      .order('appointment_time')
    setRows(data || [])

    const apptIds = (data || []).map((r: any) => String(r.appointment_id))
    if (apptIds.length > 0) {
      const { data: q } = await supabase
        .from('outgoing_call_queue')
        .select('source_id, status, followups_done, max_followups')
        .eq('category', 'no_show')
        .eq('source_table', 'validated_appointments')
        .in('source_id', apptIds)
      const map: Record<string, any> = {}
      ;(q || []).forEach((row: any) => {
        map[row.source_id] = row
      })
      setQueueStatus(map)
    } else {
      setQueueStatus({})
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  async function addToQueue(row: any) {
    setBusyId(row.appointment_id)
    const { error } = await supabase.from('outgoing_call_queue').insert({
      patient_id: row.patient_id,
      patient_name: row.patient_name,
      phone: row.phone,
      category: 'no_show',
      category_rank: 1,
      reason: `No-show on ${row.appointment_date} with ${row.doctor_service ?? 'doctor'}`,
      relevant_date: row.appointment_date,
      source_table: 'validated_appointments',
      source_id: String(row.appointment_id),
    })
    setBusyId(null)
    if (error) {
      // unique-ish race or already exists — just reload to reflect true state
      console.error(error)
    }
    load()
  }

  if (loading) return null
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400">No completed or no-show patients on this day.</p>
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
      {rows.map((r) => {
        const q = queueStatus[String(r.appointment_id)]
        return (
          <div key={r.appointment_id} className="p-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-medium text-slate-800">
                {r.patient_name}{' '}
                <span className={`text-[10px] rounded px-1.5 py-0.5 ml-1 ${STATUS_BADGE[r.validated_status]}`}>
                  {r.validated_status}
                </span>
              </div>
              <div className="text-xs text-slate-500">
                {r.appointment_time} · {r.doctor_service ?? 'Unassigned'} · {r.phone}
              </div>
            </div>
            {r.validated_status === 'No-show' && (
              <div>
                {q ? (
                  <span className="text-xs text-slate-500">
                    {q.status === 'open'
                      ? `In call queue — followup ${q.followups_done}/${q.max_followups}`
                      : `Call queue: ${q.status}`}
                  </span>
                ) : (
                  <button
                    onClick={() => addToQueue(r)}
                    disabled={busyId === r.appointment_id}
                    className="text-xs bg-teal-600 hover:bg-teal-700 text-white px-2.5 py-1.5 rounded-md disabled:opacity-50"
                  >
                    {busyId === r.appointment_id ? 'Adding…' : 'Add to call queue'}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

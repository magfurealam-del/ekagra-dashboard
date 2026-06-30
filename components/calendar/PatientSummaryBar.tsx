'use client'

export default function PatientSummaryBar({ summary }: { summary: any | null }) {
  if (!summary) return null

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
      <div className="font-medium text-slate-800">{summary.full_name}</div>
      {summary.phone && <div className="text-slate-500">{summary.phone}</div>}
      {summary.hn && <div className="text-slate-500">HN: {summary.hn}</div>}
      {summary.total_visits != null && (
        <div className="text-slate-500">Total visits: {summary.total_visits}</div>
      )}
      {summary.last_visit_date && (
        <div className="text-slate-500">Last visit: {summary.last_visit_date}</div>
      )}
      {summary.next_appointment_date && (
        <div className="text-teal-700">
          Next: {summary.next_appointment_date}
          {summary.next_appointment_doctor ? ` with ${summary.next_appointment_doctor}` : ''}
        </div>
      )}
    </div>
  )
}

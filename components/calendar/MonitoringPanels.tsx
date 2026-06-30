'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function MonitoringPanels() {
  const [tomorrow, setTomorrow] = useState<any[]>([])
  const [agents, setAgents] = useState<any[]>([])
  const [callCenter, setCallCenter] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tDate = new Date()
      tDate.setDate(tDate.getDate() + 1)
      const tStr = tDate.toISOString().slice(0, 10)

      const [{ data: t }, { data: a }, { data: cc }] = await Promise.all([
        supabase.from('calendar_appointment_detail')
          .select('appointment_time,patient_name,phone,doctor_service,service_type,appointment_status,confirmation_status,no_show_risk')
          .eq('appointment_date', tStr)
          .neq('appointment_status', 'Cancelled')
          .neq('confirmation_status', 'Confirmed')
          .order('appointment_time').limit(5),
        supabase.from('calendar_agent_performance_today').select('*'),
        supabase.from('calendar_call_center_today').select('*').single(),
      ])
      if (!cancelled) {
        setTomorrow(t || [])
        setAgents(a || [])
        setCallCenter(cc)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const RISK_BADGE: Record<string, string> = {
    high:   'bg-rose-100 text-rose-700',
    medium: 'bg-amber-100 text-amber-700',
    low:    'bg-emerald-100 text-emerald-700',
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
      {/* Tomorrow's patients requiring confirmation */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Tomorrow's Patients Requiring Confirmation</h3>
        {loading ? <div className="animate-pulse space-y-2">{[0,1,2].map(i=><div key={i} className="h-8 bg-slate-100 rounded"/>)}</div>
        : tomorrow.length === 0
          ? <p className="text-xs text-slate-400">All tomorrow's patients confirmed 🎉</p>
          : (
            <table className="w-full text-xs">
              <thead><tr className="text-slate-400">
                <th className="text-left py-1">Time</th>
                <th className="text-left py-1">Patient</th>
                <th className="text-left py-1">Doctor</th>
                <th className="text-left py-1">Risk</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {tomorrow.map((r, i) => (
                  <tr key={i}>
                    <td className="py-1.5 font-medium">{r.appointment_time}</td>
                    <td className="py-1.5">
                      <div className="font-medium text-slate-700">{r.patient_name || 'Unknown'}</div>
                      <div className="text-slate-400">{r.phone}</div>
                    </td>
                    <td className="py-1.5 text-slate-500 truncate max-w-[80px]">{(r.doctor_service||'—').replace('Dr. ','')}</td>
                    <td className="py-1.5">
                      {r.no_show_risk
                        ? <span className={`text-[10px] rounded px-1.5 py-0.5 ${RISK_BADGE[r.no_show_risk]}`}>{r.no_show_risk}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {/* Agent performance */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Call Center Executive Monitoring (Today)</h3>
        {loading ? <div className="animate-pulse space-y-2">{[0,1,2].map(i=><div key={i} className="h-8 bg-slate-100 rounded"/>)}</div>
        : agents.length === 0
          ? <p className="text-xs text-slate-400">No calls recorded yet today.</p>
          : (
            <table className="w-full text-xs">
              <thead><tr className="text-slate-400">
                <th className="text-left py-1">Agent</th>
                <th className="text-right py-1">Night-Before</th>
                <th className="text-right py-1">Morning-Of</th>
                <th className="text-right py-1">Confirmed</th>
                <th className="text-right py-1">Total</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {agents.map((a, i) => (
                  <tr key={i}>
                    <td className="py-1.5 font-medium text-slate-700">{a.agent_name}</td>
                    <td className="py-1.5 text-right">
                      <span className="text-emerald-600 font-medium">{a.nb_confirmed}</span>
                      <span className="text-slate-400">/{a.nb_total}</span>
                    </td>
                    <td className="py-1.5 text-right">
                      <span className="text-emerald-600 font-medium">{a.mo_confirmed}</span>
                      <span className="text-slate-400">/{a.mo_total}</span>
                    </td>
                    <td className="py-1.5 text-right font-medium text-teal-600">{a.total_confirmed}</td>
                    <td className="py-1.5 text-right text-slate-600">{a.total_calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {/* Call center performance */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Call Center Performance Today</h3>
        {loading ? <div className="animate-pulse space-y-2">{[0,1,2].map(i=><div key={i} className="h-10 bg-slate-100 rounded"/>)}</div>
        : (
          <div className="grid grid-cols-2 gap-2">
            {[
              { l: 'Total Calls Made',      v: callCenter?.total_calls ?? 0,         tone: 'text-slate-800' },
              { l: 'Calls Completed',        v: callCenter?.completed ?? 0,           tone: 'text-emerald-600' },
              { l: 'Call Completion Rate',   v: (callCenter?.confirmation_rate_pct ?? 0) + '%', tone: 'text-teal-600' },
              { l: 'Patients Confirmed',     v: callCenter?.confirmed ?? 0,           tone: 'text-emerald-600' },
              { l: 'Patients Reached',       v: callCenter?.reached ?? 0,            tone: 'text-indigo-600' },
              { l: 'Reschedule Requests',    v: callCenter?.reschedule_requests ?? 0, tone: 'text-amber-600' },
            ].map(m => (
              <div key={m.l} className="bg-slate-50 rounded-md p-2 text-center">
                <div className={`text-xl font-bold ${m.tone}`}>{m.v}</div>
                <div className="text-[10px] text-slate-400 leading-tight">{m.l}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatDate, formatPhone, getStatusColor } from "@/lib/utils";
import type { CallCenterLog } from "@/types";

export default function AppointmentsPage() {
  const [logs, setLogs] = useState<CallCenterLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split("T")[0]);

  useEffect(() => {
    supabase.from("call_center_logs").select("*")
      .eq("appointment_status", "Appointment done")
      .eq("appointment_date", dateFilter)
      .order("appointment_time")
      .then(({ data }) => { setLogs(data || []); setLoading(false); });
  }, [dateFilter]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Appointments</h1>
        <div className="flex gap-2 items-center">
          <input type="date" className="border rounded-lg px-3 py-1.5 text-sm" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
        </div>
      </div>
      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>{["Time", "Patient", "Phone", "Doctor", "Status", "Category", "Agent"].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y">
            {loading ? null : logs.map(log => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-xs font-mono">{log.appointment_time || "—"}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{log.patient_name}</div>
                  <div className="text-xs text-gray-400">{log.patient_id_raw}</div>
                </td>
                <td className="px-4 py-3 text-xs">{formatPhone(log.mobile_normalised)}</td>
                <td className="px-4 py-3 text-xs">{log.doctor_name_raw?.replace("Dr. ", "") || "—"}</td>
                <td className="px-4 py-3">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${getStatusColor(log.appointment_final_status)}`}>{log.appointment_final_status || "Pending"}</span>
                </td>
                <td className="px-4 py-3 text-xs">{log.internal_lead_category || "—"}</td>
                <td className="px-4 py-3 text-xs">{log.call_center_person || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && logs.length === 0 && (
          <div className="text-center py-8 text-gray-400">No appointments for {formatDate(dateFilter)}</div>
        )}
      </div>
    </div>
  );
}

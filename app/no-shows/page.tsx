"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatDate, formatPhone } from "@/lib/utils";
import type { CallCenterLog } from "@/types";

export default function NoShowsPage() {
  const [logs, setLogs] = useState<CallCenterLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<number | null>(null);

  useEffect(() => {
    supabase.from("call_center_logs")
      .select("*")
      .eq("appointment_final_status", "No Show")
      .order("appointment_date", { ascending: false })
      .then(({ data }) => { setLogs(data || []); setLoading(false); });
  }, []);

  const createCallback = async (log: CallCenterLog) => {
    setCreating(log.id);
    await fetch("/api/no-shows/create-callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: log.id }),
    });
    setCreating(null);
    alert("Callback task created in outbound queue!");
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">No Shows</h1>
      <p className="text-sm text-gray-500">Patients with No Show final status, most recent first. Add them to outbound queue to follow up.</p>

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {["Appt Date", "Patient", "Phone", "Doctor", "Category", "Agent", "Action"].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              Array(5).fill(0).map((_, i) => <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)
            ) : logs.map(log => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-xs whitespace-nowrap">{formatDate(log.appointment_date || null)}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{log.patient_name}</div>
                  <div className="text-xs text-gray-400">{log.patient_id_raw}</div>
                </td>
                <td className="px-4 py-3 text-xs">{formatPhone(log.mobile_normalised)}</td>
                <td className="px-4 py-3 text-xs">{log.doctor_name_raw?.replace("Dr. ", "") || "—"}</td>
                <td className="px-4 py-3 text-xs">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${log.internal_lead_category === "wound" ? "bg-orange-100 text-orange-700" : log.internal_lead_category === "screening" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"}`}>
                    {log.internal_lead_category || "—"}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs">{log.call_center_person || "—"}</td>
                <td className="px-4 py-3">
                  <button onClick={() => createCallback(log)} disabled={creating === log.id} className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    {creating === log.id ? "Adding…" : "→ Queue"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && logs.length === 0 && (
          <div className="text-center py-8 text-gray-400">No no-show records found 🎉</div>
        )}
      </div>
    </div>
  );
}

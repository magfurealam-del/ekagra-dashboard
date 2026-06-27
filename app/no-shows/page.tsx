"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { CallCenterLog } from "@/types";

export default function NoShowsPage() {
  const [rows, setRows] = useState<CallCenterLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<number | null>(null);
  const [done, setDone] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("call_center_logs")
      .select("*")
      .eq("appointment_final_status", "No Show")
      .order("appointment_date", { ascending: false })
      .order("log_date", { ascending: false })
      .limit(200);
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const createCallback = async (id: number) => {
    setCreating(id);
    const { error } = await supabase.rpc("create_noshow_callback", { p_log_id: id });
    setDone(d => ({ ...d, [id]: error ? `❌ ${error.message}` : "✅ Callback created" }));
    setCreating(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">No Shows</h1>
          <p className="text-sm text-gray-500">{rows.length} total · sorted by most recent first</p>
        </div>
        <button onClick={load} className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 shadow-sm">
          🔄 Refresh
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">{Array(8).fill(0).map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-5xl mb-3">✅</div>
          <div className="text-lg font-medium">No no-shows recorded</div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {["Patient","Phone","Doctor","Appt Date","Source","Category","Action"].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{r.patient_name || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{r.mobile_raw || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{r.doctor_name_raw || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.appointment_date || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{r.call_source || "—"}</td>
                    <td className="px-4 py-3">
                      {r.internal_lead_category && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          r.internal_lead_category === "wound" ? "bg-orange-100 text-orange-700"
                          : r.internal_lead_category === "screening" ? "bg-amber-100 text-amber-700"
                          : "bg-gray-100 text-gray-600"}`}>
                          {r.internal_lead_category}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {done[r.id] ? (
                        <span className="text-xs">{done[r.id]}</span>
                      ) : (
                        <button onClick={() => createCallback(r.id)} disabled={creating === r.id}
                          className="px-3 py-1.5 bg-teal-600 text-white text-xs rounded-lg hover:bg-teal-700 disabled:opacity-60 transition-colors">
                          {creating === r.id ? "…" : "Create Callback"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

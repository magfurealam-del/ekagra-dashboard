"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { getStatusColor } from "@/lib/utils";
import type { CallCenterLog } from "@/types";

const FINAL_STATUSES = ["Appointment Done","No Show","Not Interested","Rescheduled","General Inquiry"];

export default function AppointmentsPage() {
  const [rows, setRows] = useState<CallCenterLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [updating, setUpdating] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("call_center_logs")
      .select("*")
      .not("appointment_status", "is", null)
      .order("appointment_date", { ascending: false })
      .order("log_date", { ascending: false })
      .limit(500);

    if (filterStatus) q = q.eq("appointment_final_status", filterStatus);
    if (dateFrom) q = q.gte("appointment_date", dateFrom);
    if (dateTo) q = q.lte("appointment_date", dateTo);

    const { data } = await q;
    let filtered = data || [];
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(r =>
        r.patient_name?.toLowerCase().includes(s) ||
        r.mobile_raw?.includes(s) ||
        r.doctor_name_raw?.toLowerCase().includes(s)
      );
    }
    setRows(filtered);
    setLoading(false);
  }, [search, filterStatus, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase.channel("appts")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "call_center_logs" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const updateStatus = async (id: number, status: string) => {
    setUpdating(id);
    await supabase.from("call_center_logs").update({
      appointment_final_status: status,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    // Auto create callback for no-show
    if (status === "No Show") {
      await supabase.rpc("create_noshow_callback", { p_log_id: id }).catch(() => {});
    }
    await load();
    setUpdating(null);
  };

  const today = new Date().toISOString().slice(0, 10);
  const todayCount = rows.filter(r => r.appointment_date === today).length;
  const noShowCount = rows.filter(r => r.appointment_final_status === "No Show").length;
  const upcoming = rows.filter(r => r.appointment_date && r.appointment_date > today).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Appointments</h1>
          <p className="text-sm text-gray-500">{rows.length} records</p>
        </div>
        <button onClick={load} className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 shadow-sm">
          🔄 Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Today", count: todayCount, color: "text-teal-600" },
          { label: "Upcoming", count: upcoming, color: "text-blue-600" },
          { label: "No Shows", count: noShowCount, color: "text-red-600" },
          { label: "Total", count: rows.length, color: "text-gray-700" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-3 text-center shadow-sm">
            <div className={`text-2xl font-bold ${s.color}`}>{s.count}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input type="search" placeholder="Search patient, phone, doctor…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm" />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm">
          <option value="">All Statuses</option>
          {FINAL_STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["Patient","Phone","Appt Date","Time","Doctor","Source","Final Status","Update"].map(h => (
                  <th key={h} className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? Array(8).fill(0).map((_, i) => (
                <tr key={i}>{Array(8).fill(0).map((_, j) => (
                  <td key={j} className="px-3 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                ))}</tr>
              )) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">No appointments found</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className={`hover:bg-gray-50 ${r.appointment_date === today ? "bg-teal-50/40" : ""}`}>
                  <td className="px-3 py-3">
                    <div className="font-medium text-gray-800">{r.patient_name || "—"}</div>
                    {r.appointment_date === today && (
                      <span className="text-xs bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded font-medium">Today</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-gray-600">{r.mobile_raw || "—"}</td>
                  <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{r.appointment_date || "—"}</td>
                  <td className="px-3 py-3 text-gray-600">{r.appointment_time || "—"}</td>
                  <td className="px-3 py-3 text-gray-600">{r.doctor_name_raw || "—"}</td>
                  <td className="px-3 py-3 text-gray-600">{r.call_source || "—"}</td>
                  <td className="px-3 py-3">
                    {r.appointment_final_status ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusColor(r.appointment_final_status)}`}>
                        {r.appointment_final_status}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-3">
                    <select value={r.appointment_final_status || ""}
                      onChange={e => updateStatus(r.id, e.target.value)}
                      disabled={updating === r.id}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-xs disabled:opacity-60">
                      <option value="">Update…</option>
                      {FINAL_STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

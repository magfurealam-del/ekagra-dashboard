"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getStatusColor } from "@/lib/utils";
import type { CallCenterLog } from "@/types";

const PAGE = 50;

export default function CallCenterPage() {
  const [rows, setRows] = useState<CallCenterLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterFinal, setFilterFinal] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<CallCenterLog>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("call_center_logs").select("*", { count: "exact" })
      .order("log_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);

    if (filterFinal) q = q.eq("appointment_final_status", filterFinal);
    if (filterCategory) q = q.eq("internal_lead_category", filterCategory);
    if (dateFrom) q = q.gte("log_date", dateFrom);
    if (dateTo) q = q.lte("log_date", dateTo);

    let data: CallCenterLog[] = [];
    let count = 0;

    if (search) {
      // client-side search on a broad select
      const { data: all } = await supabase.from("call_center_logs").select("*")
        .order("log_date", { ascending: false })
        .limit(2000);
      const s = search.toLowerCase();
      data = (all || []).filter(r =>
        r.patient_name?.toLowerCase().includes(s) ||
        r.mobile_raw?.includes(s) ||
        r.patient_id_raw?.toLowerCase().includes(s)
      );
      count = data.length;
      data = data.slice(page * PAGE, page * PAGE + PAGE);
    } else {
      const res = await q;
      data = res.data || [];
      count = res.count || 0;
    }

    setRows(data);
    setTotal(count);
    setLoading(false);
  }, [page, search, filterFinal, filterCategory, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (r: CallCenterLog) => {
    setEditId(r.id);
    setEditData({
      appointment_status: r.appointment_status,
      appointment_final_status: r.appointment_final_status,
      doctor_name_raw: r.doctor_name_raw,
      revenue_to_date: r.revenue_to_date,
      comments: r.comments,
    });
  };

  const saveEdit = async (id: number) => {
    setSaving(true);
    await supabase.from("call_center_logs").update({
      ...editData,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    setEditId(null);
    setSaving(false);
    load();
  };

  const pages = Math.ceil(total / PAGE);

  const FINAL_STATUSES = ["Appointment Done","No Show","Not Interested","Rescheduled","General Inquiry"];
  const APPT_STATUSES = ["Appointment done","No appointment yet","Not interested","Wrong number","Rescheduled"];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Call Center Logs</h1>
          <p className="text-sm text-gray-500">{total.toLocaleString()} total records</p>
        </div>
        <Link href="/call-center/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 transition-colors shadow-sm">
          ➕ Add New Lead
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <input type="search" placeholder="Search name, phone, patient ID…" value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm" />
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0); }}
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm" />
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0); }}
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm" />
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={filterFinal} onChange={e => { setFilterFinal(e.target.value); setPage(0); }}
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm">
            <option value="">All Final Statuses</option>
            {FINAL_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setPage(0); }}
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm">
            <option value="">All Categories</option>
            <option value="wound">Wound</option>
            <option value="screening">Screening</option>
            <option value="other">Other</option>
          </select>
          {(search || filterFinal || filterCategory || dateFrom || dateTo) && (
            <button onClick={() => { setSearch(""); setFilterFinal(""); setFilterCategory(""); setDateFrom(""); setDateTo(""); setPage(0); }}
              className="px-3 py-2 text-sm text-red-600 hover:text-red-800">✕ Clear</button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["Date","Patient","Phone","Category","Doctor","Appt Status","Final Status","Revenue","Agent","Edit"].map(h => (
                  <th key={h} className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? Array(8).fill(0).map((_, i) => (
                <tr key={i}>{Array(10).fill(0).map((_, j) => (
                  <td key={j} className="px-3 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                ))}</tr>
              )) : rows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">No records found</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{r.log_date || "—"}</td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-gray-800">{r.patient_name || "—"}</div>
                    {r.patient_id_raw && <div className="text-xs text-gray-400">{r.patient_id_raw}</div>}
                  </td>
                  <td className="px-3 py-3 text-gray-600">{r.mobile_raw || "—"}</td>
                  <td className="px-3 py-3">
                    {r.internal_lead_category && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        r.internal_lead_category === "wound" ? "bg-orange-100 text-orange-700"
                        : r.internal_lead_category === "screening" ? "bg-amber-100 text-amber-700"
                        : "bg-gray-100 text-gray-600"}`}>
                        {r.internal_lead_category}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-gray-600">
                    {editId === r.id ? (
                      <input value={(editData.doctor_name_raw as string) || ""}
                        onChange={e => setEditData(d => ({ ...d, doctor_name_raw: e.target.value }))}
                        className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-28" />
                    ) : r.doctor_name_raw || "—"}
                  </td>
                  <td className="px-3 py-3">
                    {editId === r.id ? (
                      <select value={(editData.appointment_status as string) || ""}
                        onChange={e => setEditData(d => ({ ...d, appointment_status: e.target.value }))}
                        className="border border-gray-300 rounded-lg px-2 py-1 text-xs">
                        <option value="">—</option>
                        {APPT_STATUSES.map(s => <option key={s}>{s}</option>)}
                      </select>
                    ) : <span className="text-gray-600">{r.appointment_status || "—"}</span>}
                  </td>
                  <td className="px-3 py-3">
                    {editId === r.id ? (
                      <select value={(editData.appointment_final_status as string) || ""}
                        onChange={e => setEditData(d => ({ ...d, appointment_final_status: e.target.value }))}
                        className="border border-gray-300 rounded-lg px-2 py-1 text-xs">
                        <option value="">—</option>
                        {FINAL_STATUSES.map(s => <option key={s}>{s}</option>)}
                      </select>
                    ) : r.appointment_final_status ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusColor(r.appointment_final_status)}`}>
                        {r.appointment_final_status}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-3 text-gray-600">
                    {r.revenue_to_date ? `৳${r.revenue_to_date.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-3 py-3 text-gray-600">{r.call_center_person || "—"}</td>
                  <td className="px-3 py-3">
                    {editId === r.id ? (
                      <div className="flex gap-1">
                        <button onClick={() => saveEdit(r.id)} disabled={saving}
                          className="px-2 py-1 bg-teal-600 text-white text-xs rounded-lg hover:bg-teal-700 disabled:opacity-60">
                          {saving ? "…" : "Save"}
                        </button>
                        <button onClick={() => setEditId(null)}
                          className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(r)}
                        className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200 transition-colors">
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-gray-500">Page {page + 1} of {pages} · {total} records</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-3 py-1.5 bg-white border border-gray-300 rounded-xl text-sm disabled:opacity-40">← Prev</button>
            <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
              className="px-3 py-1.5 bg-white border border-gray-300 rounded-xl text-sm disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useDropdowns } from "@/lib/useDropdowns";
import { formatDate, formatPhone, getStatusColor } from "@/lib/utils";
import type { CallCenterLog } from "@/types";

const PAGE_SIZE = 50;

export default function CallCenterPage() {
  const [logs, setLogs] = useState<CallCenterLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    dateFrom: "", dateTo: "", appointmentStatus: "", finalStatus: "",
    agent: "", doctor: "", leadCategory: "", source: "", noShowOnly: false, fbOnly: false,
  });
  const { dropdowns } = useDropdowns();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Partial<CallCenterLog>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("call_center_logs").select("*", { count: "exact" });
    if (search) q = q.or(`patient_name.ilike.%${search}%,mobile_normalised.ilike.%${search}%,patient_id_raw.ilike.%${search}%`);
    if (filters.dateFrom) q = q.gte("log_date", filters.dateFrom);
    if (filters.dateTo) q = q.lte("log_date", filters.dateTo);
    if (filters.appointmentStatus) q = q.eq("appointment_status", filters.appointmentStatus);
    if (filters.finalStatus) q = q.eq("appointment_final_status", filters.finalStatus);
    if (filters.agent) q = q.eq("call_center_person", filters.agent);
    if (filters.source) q = q.eq("call_source", filters.source);
    if (filters.leadCategory) q = q.eq("internal_lead_category", filters.leadCategory);
    if (filters.noShowOnly) q = q.eq("appointment_final_status", "No Show");
    if (filters.fbOnly) q = q.eq("lead_source", "facebook");
    const { data, count, error } = await q
      .order("log_date", { ascending: false })
      .order("id", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (!error) { setLogs(data || []); setTotal(count || 0); }
    setLoading(false);
  }, [search, filters, page]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const startEdit = (log: CallCenterLog) => {
    setEditingId(log.id);
    setSaveError("");
    setEditValues({
      appointment_status: log.appointment_status,
      appointment_final_status: log.appointment_final_status,
      doctor_name_raw: log.doctor_name_raw,
      call_center_person: log.call_center_person,
      comments: log.comments,
      revenue_to_date: log.revenue_to_date,
      lead_category: log.lead_category,
      internal_lead_category: log.internal_lead_category,
      priority: log.priority,
    });
  };

  // Direct Supabase write — bidirectional
  const saveEdit = async (id: number) => {
    setSaving(true); setSaveError("");
    const { data, error } = await supabase
      .from("call_center_logs")
      .update({ ...editValues, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) {
      setSaveError(error.message);
    } else {
      setLogs(prev => prev.map(l => l.id === id ? { ...l, ...data } as CallCenterLog : l));
      setEditingId(null);
    }
    setSaving(false);
  };

  const handleFilterChange = (key: string, value: string | boolean) => {
    setFilters(f => ({ ...f, [key]: value }));
    setPage(0);
  };

  const clearFilters = () => {
    setFilters({ dateFrom: "", dateTo: "", appointmentStatus: "", finalStatus: "", agent: "", doctor: "", leadCategory: "", source: "", noShowOnly: false, fbOnly: false });
    setSearch(""); setPage(0);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Call Center Logs</h1>
        <div className="flex gap-2 items-center">
          <span className="text-sm text-gray-500">{total.toLocaleString()} records</span>
          <Link href="/call-center/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">+ New Lead</Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border p-4 space-y-3">
        <input type="text" placeholder="Search by name, phone, or patient ID…"
          className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          <input type="date" className="border rounded px-2 py-1.5 text-xs" value={filters.dateFrom} onChange={e => handleFilterChange("dateFrom", e.target.value)} />
          <input type="date" className="border rounded px-2 py-1.5 text-xs" value={filters.dateTo} onChange={e => handleFilterChange("dateTo", e.target.value)} />
          <select className="border rounded px-2 py-1.5 text-xs" value={filters.appointmentStatus} onChange={e => handleFilterChange("appointmentStatus", e.target.value)}>
            <option value="">All Statuses</option>
            {dropdowns.appointmentStatuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="border rounded px-2 py-1.5 text-xs" value={filters.finalStatus} onChange={e => handleFilterChange("finalStatus", e.target.value)}>
            <option value="">All Final</option>
            {dropdowns.finalStatuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="border rounded px-2 py-1.5 text-xs" value={filters.agent} onChange={e => handleFilterChange("agent", e.target.value)}>
            <option value="">All Agents</option>
            {dropdowns.agents.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          <select className="border rounded px-2 py-1.5 text-xs" value={filters.source} onChange={e => handleFilterChange("source", e.target.value)}>
            <option value="">All Sources</option>
            {dropdowns.sources.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="border rounded px-2 py-1.5 text-xs" value={filters.leadCategory} onChange={e => handleFilterChange("leadCategory", e.target.value)}>
            <option value="">All Categories</option>
            {dropdowns.internalLeadCategories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className="flex gap-4 items-center">
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={filters.noShowOnly} onChange={e => handleFilterChange("noShowOnly", e.target.checked)} className="rounded" />No Shows Only
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={filters.fbOnly} onChange={e => handleFilterChange("fbOnly", e.target.checked)} className="rounded" />Facebook Only
          </label>
          <button onClick={clearFilters} className="text-xs text-blue-600 hover:underline">Clear filters</button>
        </div>
      </div>

      {saveError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{saveError}</div>}

      {/* Table */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {["Date","Patient","Phone","Loc","Type","Call Category","Source","Appt Status","Doctor","Appt Date","Category","Final Status","Revenue","Agent",""].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                Array(10).fill(0).map((_, i) => (
                  <tr key={i}><td colSpan={15} className="px-3 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : logs.length === 0 ? (
                <tr><td colSpan={15} className="px-3 py-10 text-center text-gray-400">No records found</td></tr>
              ) : logs.map(log => {
                const isEditing = editingId === log.id;
                return (
                  <tr key={log.id} className={`hover:bg-gray-50 ${isEditing ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : ""}`}>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">{formatDate(log.log_date)}</td>
                    <td className="px-3 py-2">
                      <Link href={`/call-center/${log.id}`} className="font-medium text-blue-700 hover:underline text-xs">{log.patient_name || "—"}</Link>
                      {log.patient_id_raw && <div className="text-xs text-gray-400">{log.patient_id_raw}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{formatPhone(log.mobile_normalised)}</td>
                    <td className="px-3 py-2 text-xs">{log.location || "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${log.patient_type === "new" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                        {log.patient_type || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs max-w-[140px] truncate">{log.call_category || "—"}</td>
                    <td className="px-3 py-2 text-xs max-w-[120px] truncate">{log.call_source || "—"}</td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <select className="border rounded px-1 py-0.5 text-xs w-full" value={editValues.appointment_status || ""} onChange={e => setEditValues(v => ({ ...v, appointment_status: e.target.value }))}>
                          <option value="">—</option>
                          {dropdowns.appointmentStatuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      ) : (
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${getStatusColor(log.appointment_status)}`}>{log.appointment_status || "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {isEditing ? (
                        <select className="border rounded px-1 py-0.5 text-xs w-full" value={editValues.doctor_name_raw || ""} onChange={e => setEditValues(v => ({ ...v, doctor_name_raw: e.target.value }))}>
                          <option value="">— None —</option>
                          {dropdowns.doctors.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                      ) : (log.doctor_name_raw?.replace("Dr. ", "") || "—")}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{formatDate(log.appointment_date || null)}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${log.internal_lead_category === "wound" ? "bg-orange-100 text-orange-700" : log.internal_lead_category === "screening" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"}`}>
                        {log.internal_lead_category || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <select className="border rounded px-1 py-0.5 text-xs w-full" value={editValues.appointment_final_status || ""} onChange={e => setEditValues(v => ({ ...v, appointment_final_status: e.target.value }))}>
                          <option value="">—</option>
                          {dropdowns.finalStatuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      ) : (
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${getStatusColor(log.appointment_final_status)}`}>{log.appointment_final_status || "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {isEditing ? (
                        <input type="number" className="border rounded px-1 py-0.5 text-xs w-20" value={editValues.revenue_to_date || ""} onChange={e => setEditValues(v => ({ ...v, revenue_to_date: parseFloat(e.target.value) }))} />
                      ) : (log.revenue_to_date ? `৳${log.revenue_to_date.toLocaleString()}` : "—")}
                    </td>
                    <td className="px-3 py-2 text-xs">{log.call_center_person || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isEditing ? (
                        <div className="flex gap-1 flex-col">
                          <div className="flex gap-1">
                            <button onClick={() => saveEdit(log.id)} disabled={saving} className="bg-green-600 text-white px-2 py-0.5 rounded text-xs hover:bg-green-700 disabled:opacity-50">{saving ? "…" : "Save"}</button>
                            <button onClick={() => { setEditingId(null); setSaveError(""); }} className="bg-gray-200 text-gray-700 px-2 py-0.5 rounded text-xs hover:bg-gray-300">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <button onClick={() => startEdit(log)} className="text-xs text-blue-600 hover:underline">Edit</button>
                          <Link href={`/call-center/${log.id}`} className="text-xs text-gray-500 hover:underline">View</Link>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
          <span className="text-xs text-gray-500">Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1 border rounded text-xs disabled:opacity-40 hover:bg-gray-100">← Prev</button>
            <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total} className="px-3 py-1 border rounded text-xs disabled:opacity-40 hover:bg-gray-100">Next →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

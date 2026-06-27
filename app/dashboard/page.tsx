"use client";
import { useState, useEffect, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from "recharts";
import type { ExecMetrics } from "@/types";

type Period = "today" | "week" | "month" | "custom";
const PERIODS = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom" },
] as const;

function KPI({ label, value, sub, accent = "teal", loading }: {
  label: string; value: string | number; sub?: string; accent?: string; loading?: boolean;
}) {
  const accentMap: Record<string, string> = {
    teal: "border-teal-400", red: "border-red-400", blue: "border-blue-400",
    amber: "border-amber-400", purple: "border-purple-400", green: "border-green-400",
  };
  return (
    <div className={`bg-white rounded-xl border-l-4 p-4 shadow-sm ${accentMap[accent] || accentMap.teal}`}>
      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-gray-200 rounded w-2/3" />
          <div className="h-7 bg-gray-200 rounded w-1/2" />
        </div>
      ) : (
        <>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</div>
          <div className="text-2xl font-bold text-gray-800">{value}</div>
          {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
        </>
      )}
    </div>
  );
}

function Alert({ icon, text, count, color }: { icon: string; text: string; count: number; color: string }) {
  if (!count) return null;
  const cls = color === "red" ? "bg-red-50 border-red-200 text-red-800"
    : color === "amber" ? "bg-amber-50 border-amber-200 text-amber-800"
    : "bg-blue-50 border-blue-200 text-blue-800";
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${cls}`}>
      <span className="text-lg">{icon}</span>
      <span className="flex-1 text-sm font-medium">{text}</span>
      <span className="text-xl font-bold">{count}</span>
    </div>
  );
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [metrics, setMetrics] = useState<ExecMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const p = new URLSearchParams({ period });
      if (period === "custom" && customStart && customEnd) {
        p.set("start", customStart); p.set("end", customEnd);
      }
      const res = await fetch(`/api/executive-metrics?${p}`);
      if (!res.ok) throw new Error(await res.text());
      setMetrics(await res.json());
      setUpdated(new Date());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [period, customStart, customEnd]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const fmt = (n?: number | null) => (n ?? 0).toLocaleString("en-BD");
  const fmtTk = (n?: number | null) => "৳" + (n ?? 0).toLocaleString("en-BD");
  const fmtPct = (n?: number | null) => (n ?? 0) + "%";

  const trendData = (metrics?.daily_trend || []).slice(-30);
  const sourceData = (metrics?.by_source || []).map(s => ({ name: s.source || "Unknown", value: s.count }));
  const doctorData = (metrics?.by_doctor || []).slice(0, 8).map(d => ({ name: d.doctor?.split(" ").pop() || d.doctor || "—", count: d.count }));
  const statusData = (metrics?.by_final_status || []).map(s => ({ name: s.status || "—", value: s.count }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Executive Dashboard</h1>
          <p className="text-sm text-gray-500">
            {updated ? `Last updated ${updated.toLocaleTimeString("en-BD")}` : "Loading…"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-gray-100 rounded-xl p-1 gap-0.5">
            {PERIODS.map(p => (
              <button key={p.value} onClick={() => setPeriod(p.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  period === p.value ? "bg-white text-teal-700 shadow-sm" : "text-gray-600 hover:text-gray-900"
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={load}
            className="p-2 bg-white border border-gray-200 rounded-xl text-gray-500 hover:text-teal-600 transition-colors shadow-sm"
            title="Refresh">
            <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {period === "custom" && (
        <div className="flex flex-wrap items-center gap-3 p-4 bg-white rounded-xl border shadow-sm">
          <label className="text-sm text-gray-600">From</label>
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
          <label className="text-sm text-gray-600">To</label>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
          <button onClick={load} className="px-4 py-1.5 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700">Apply</button>
        </div>
      )}

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

      {/* KPIs Row 1 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        <KPI label="Total Leads" value={fmt(metrics?.total_leads)} accent="teal" loading={loading} />
        <KPI label="Appointments" value={fmt(metrics?.appointments_booked)} accent="green" loading={loading} />
        <KPI label="Conversion" value={fmtPct(metrics?.appointment_conversion_rate)} accent="blue" loading={loading} />
        <KPI label="No Shows" value={fmt(metrics?.no_shows)} accent="red" loading={loading} />
        <KPI label="No Show Rate" value={fmtPct(metrics?.no_show_rate)} accent="amber" loading={loading} />
        <KPI label="Revenue" value={fmtTk(metrics?.total_revenue)} accent="green" loading={loading} />
        <KPI label="FB Revenue" value={fmtTk(metrics?.facebook_revenue)} accent="blue" loading={loading} />
      </div>

      {/* KPIs Row 2 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPI label="Wound Leads" value={fmt(metrics?.wound_leads)} accent="red" loading={loading} />
        <KPI label="Screening Leads" value={fmt(metrics?.screening_leads)} accent="amber" loading={loading} />
        <KPI label="FB Leads" value={fmt(metrics?.leads_from_facebook)} accent="blue" loading={loading} />
        <KPI label="Pending Callbacks" value={fmt(metrics?.pending_callbacks)} accent="purple" loading={loading} />
        <KPI label="Follow-ups Today" value={fmt(metrics?.followups_due_today)} accent="amber" loading={loading} />
      </div>

      {/* Alerts */}
      {!loading && metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <Alert icon="🚫" text="No Shows to Call Back" count={metrics.no_shows} color="red" />
          <Alert icon="🩹" text="Wound Leads Without Appointment" count={metrics.wound_leads} color="red" />
          <Alert icon="🔬" text="Screening Leads Without Appointment" count={metrics.screening_leads} color="amber" />
          <Alert icon="🔁" text="Pending Callbacks" count={metrics.pending_callbacks} color="amber" />
          <Alert icon="⏰" text="Follow-ups Due Today" count={metrics.followups_due_today} color="red" />
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Trend chart */}
        {trendData.length > 1 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Daily Trend — Leads & Appointments</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="leads" stroke="#14b8a6" strokeWidth={2} dot={false} name="Leads" />
                <Line type="monotone" dataKey="appointments" stroke="#22c55e" strokeWidth={2} dot={false} name="Appointments" />
                <Line type="monotone" dataKey="no_shows" stroke="#ef4444" strokeWidth={2} dot={false} name="No Shows" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* By Source */}
        {sourceData.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Leads by Source</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={sourceData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                <Tooltip />
                <Bar dataKey="value" fill="#14b8a6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* By Doctor */}
        {doctorData.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Appointments by Doctor</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={doctorData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Final Status */}
        {statusData.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Final Status Breakdown</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={statusData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                <Tooltip />
                <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Agent performance table */}
      {!loading && (metrics?.by_agent?.length || 0) > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Agent Performance</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <th className="py-2 pr-4 text-gray-500 font-medium">Agent</th>
                  <th className="py-2 px-4 text-teal-600 font-medium text-right">Leads</th>
                </tr>
              </thead>
              <tbody>
                {(metrics?.by_agent || []).map((a, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 pr-4 text-gray-700">{a.agent || "Unknown"}</td>
                    <td className="py-2 px-4 font-semibold text-teal-700 text-right">{a.count}</td>
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

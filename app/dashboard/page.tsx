"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];

export default function DashboardPage() {
  const [stats, setStats] = useState({
    leadsToday: 0, appointmentsToday: 0, noShowsToday: 0,
    pendingCallbacks: 0, woundNoAppt: 0, screeningNoAppt: 0,
    totalRevenue: 0, facebookLeads: 0,
  });
  const [sourceData, setSourceData] = useState<{ name: string; value: number }[]>([]);
  const [doctorData, setDoctorData] = useState<{ name: string; count: number }[]>([]);
  const [finalStatusData, setFinalStatusData] = useState<{ name: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      const today = new Date().toISOString().split("T")[0];
      const [
        { count: leadsToday },
        { count: appointmentsToday },
        { count: noShowsToday },
        { count: pendingCallbacks },
        { count: woundNoAppt },
        { count: screeningNoAppt },
        { data: revenueData },
        { count: facebookLeads },
      ] = await Promise.all([
        supabase.from("call_center_logs").select("*", { count: "exact", head: true }).eq("log_date", today),
        supabase.from("call_center_logs").select("*", { count: "exact", head: true }).eq("log_date", today).eq("appointment_status", "Appointment done"),
        supabase.from("call_center_logs").select("*", { count: "exact", head: true }).eq("appointment_final_status", "No Show").gte("appointment_date", new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]),
        supabase.from("callback_tasks").select("*", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("call_center_logs").select("*", { count: "exact", head: true }).eq("internal_lead_category", "wound").eq("appointment_status", "No appointment yet"),
        supabase.from("call_center_logs").select("*", { count: "exact", head: true }).eq("internal_lead_category", "screening").eq("appointment_status", "No appointment yet"),
        supabase.from("call_center_logs").select("revenue_to_date").not("revenue_to_date", "is", null),
        supabase.from("call_center_logs").select("*", { count: "exact", head: true }).eq("lead_source", "facebook"),
      ]);

      const totalRevenue = (revenueData || []).reduce((s: number, r: { revenue_to_date: number }) => s + (r.revenue_to_date || 0), 0);

      setStats({
        leadsToday: leadsToday || 0,
        appointmentsToday: appointmentsToday || 0,
        noShowsToday: noShowsToday || 0,
        pendingCallbacks: pendingCallbacks || 0,
        woundNoAppt: woundNoAppt || 0,
        screeningNoAppt: screeningNoAppt || 0,
        totalRevenue,
        facebookLeads: facebookLeads || 0,
      });

      // Source breakdown
      const { data: srcData } = await supabase.from("call_center_logs").select("call_source").not("call_source", "is", null);
      const srcCounts: Record<string, number> = {};
      (srcData || []).forEach((r: { call_source: string }) => { srcCounts[r.call_source] = (srcCounts[r.call_source] || 0) + 1; });
      setSourceData(Object.entries(srcCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value));

      // Doctor breakdown
      const { data: drData } = await supabase.from("call_center_logs").select("doctor_name_raw").not("doctor_name_raw", "is", null).eq("appointment_status", "Appointment done");
      const drCounts: Record<string, number> = {};
      (drData || []).forEach((r: { doctor_name_raw: string }) => { drCounts[r.doctor_name_raw] = (drCounts[r.doctor_name_raw] || 0) + 1; });
      setDoctorData(Object.entries(drCounts).map(([name, count]) => ({ name: name.replace("Dr. ", ""), count })).sort((a, b) => b.count - a.count).slice(0, 8));

      // Final status
      const { data: fsData } = await supabase.from("call_center_logs").select("appointment_final_status").not("appointment_final_status", "is", null);
      const fsCounts: Record<string, number> = {};
      (fsData || []).forEach((r: { appointment_final_status: string }) => { fsCounts[r.appointment_final_status] = (fsCounts[r.appointment_final_status] || 0) + 1; });
      setFinalStatusData(Object.entries(fsCounts).map(([name, value]) => ({ name, value })));

      setLoading(false);
    }
    fetchStats();
  }, []);

  const cards = [
    { label: "Leads Today", value: stats.leadsToday, color: "blue", icon: "📞" },
    { label: "Appointments Today", value: stats.appointmentsToday, color: "green", icon: "✅" },
    { label: "No Shows (7d)", value: stats.noShowsToday, color: "red", icon: "🚫" },
    { label: "Pending Callbacks", value: stats.pendingCallbacks, color: "orange", icon: "🔁" },
    { label: "Wound — No Appt", value: stats.woundNoAppt, color: "purple", icon: "🩹" },
    { label: "Screening — No Appt", value: stats.screeningNoAppt, color: "indigo", icon: "🔬" },
    { label: "Total Revenue", value: formatCurrency(stats.totalRevenue), color: "emerald", icon: "💰", wide: true },
    { label: "Facebook Leads", value: stats.facebookLeads, color: "blue", icon: "📘" },
  ];

  const colorMap: Record<string, string> = {
    blue: "border-blue-200 bg-blue-50", green: "border-green-200 bg-green-50",
    red: "border-red-200 bg-red-50", orange: "border-orange-200 bg-orange-50",
    purple: "border-purple-200 bg-purple-50", indigo: "border-indigo-200 bg-indigo-50",
    emerald: "border-emerald-200 bg-emerald-50",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <span className="text-sm text-gray-500">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array(8).fill(0).map((_, i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {cards.map((card) => (
            <div key={card.label} className={`border rounded-xl p-4 ${colorMap[card.color]} ${(card as { wide?: boolean }).wide ? "col-span-2" : ""}`}>
              <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                <span>{card.icon}</span>{card.label}
              </div>
              <div className="text-2xl font-bold text-gray-900">{card.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border p-4 col-span-2">
          <h2 className="font-semibold text-gray-700 mb-4">Appointments by Doctor</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={doctorData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="name" type="category" width={130} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#3B82F6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <h2 className="font-semibold text-gray-700 mb-4">Final Status Breakdown</h2>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={finalStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={false}>
                {finalStatusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border p-4 col-span-3">
          <h2 className="font-semibold text-gray-700 mb-4">Leads by Source</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={sourceData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#10B981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

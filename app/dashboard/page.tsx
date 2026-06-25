"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  LineChart, Line, Area, AreaChart,
} from "recharts";

const COLORS = ["#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899"];

function StatCard({ label, today, month, total, color, icon, isCurrency }: {
  label: string; today: number; month: number; total: number;
  color: string; icon: string; isCurrency?: boolean;
}) {
  const fmt = (v: number) => isCurrency ? formatCurrency(v) : v.toLocaleString();
  const bg: Record<string,string> = {
    blue:"bg-blue-50 border-blue-200", green:"bg-green-50 border-green-200",
    red:"bg-red-50 border-red-200", orange:"bg-orange-50 border-orange-200",
    purple:"bg-purple-50 border-purple-200", emerald:"bg-emerald-50 border-emerald-200",
  };
  return (
    <div className={`border rounded-xl p-4 ${bg[color]}`}>
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2">
        <span>{icon}</span>{label}
      </div>
      <div className="text-2xl font-bold text-gray-900 mb-2">{fmt(total)}</div>
      <div className="flex gap-3 text-xs text-gray-500">
        <span>Today: <span className="font-semibold text-gray-700">{fmt(today)}</span></span>
        <span>·</span>
        <span>This month: <span className="font-semibold text-gray-700">{fmt(month)}</span></span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const today = new Date().toISOString().split("T")[0];
  const monthStart = today.slice(0, 7) + "-01";

  const [stats, setStats] = useState({
    leadsToday:0, leadsMonth:0, leadsTotal:0,
    apptToday:0, apptMonth:0, apptTotal:0,
    noShowToday:0, noShowMonth:0, noShowTotal:0,
    revenueToday:0, revenueMonth:0, revenueTotal:0,
    fbTotal:0, fbMonth:0,
    woundNoAppt:0, screeningNoAppt:0, pendingCallbacks:0,
  });
  const [monthlyData, setMonthlyData] = useState<{month:string;leads:number;appointments:number;no_shows:number}[]>([]);
  const [sourceData, setSourceData] = useState<{name:string;value:number}[]>([]);
  const [doctorData, setDoctorData] = useState<{name:string;count:number}[]>([]);
  const [finalStatusData, setFinalStatusData] = useState<{name:string;value:number}[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // All logs (lightweight selects)
      const [
        {count: leadsTotal}, {count: leadsMonth}, {count: leadsToday},
        {count: apptTotal}, {count: apptMonth}, {count: apptToday},
        {count: noShowTotal}, {count: noShowMonth},
        {count: fbTotal}, {count: fbMonth},
        {count: woundNoAppt}, {count: screeningNoAppt},
        {count: pendingCallbacks},
        {data: revData},
      ] = await Promise.all([
        supabase.from("call_center_logs").select("*",{count:"exact",head:true}),
        supabase.from("call_center_logs").select("*",{count:"exact",head:true}).gte("log_date", monthStart),
        supabase.from("call_center_logs").select("*",{count:"exact",head:true}).eq("log_date", today),
        supabase.from("call_center_logs").select("*",{count:"exact",head:true}).eq("appointment_status","Appointment done"),
        supabase.from("call_center_logs").select("*",{count:"exact",head:true}).eq("appointment_status","Appointment done").gte("log_date", monthStart),
        supabase.from("call_center_logs").select("*",{count:"exact",head:true}).eq("appointment_status","Appointment done").eq("log_date", today),
        supabase.from("call_center_logs").select("*",{count:"exact",head:true}).eq("appointment_final_status","No Show"),
        supabase.from("call_center_logs").select("*",{count:"exact",head:true}).eq("appointment_final_status","No Show").gte("log_date", monthStart),
        supabase.from("call_center_logs").select("*",{count:"exact",head:true}).eq("lead_source","facebook"),
        supabase.from("call_center_logs").select("*",{count:"exact",head:true}).eq("lead_source","facebook").gte("log_date", monthStart),
        supabase.from("call_center_logs").select("*",{count:"exact",head:true}).eq("internal_lead_category","wound").eq("appointment_status","No appointment yet"),
        supabase.from("call_center_logs").select("*",{count:"exact",head:true}).eq("internal_lead_category","screening").eq("appointment_status","No appointment yet"),
        supabase.from("callback_tasks").select("*",{count:"exact",head:true}).eq("status","pending"),
        supabase.from("call_center_logs").select("revenue_to_date").not("revenue_to_date","is",null),
      ]);

      const rev = (revData||[]) as {revenue_to_date:number}[];
      const revenueTotal = rev.reduce((s,r)=>s+(r.revenue_to_date||0),0);

      // Revenue this month and today (rough from same data filtered)
      const {data: revMonth} = await supabase.from("call_center_logs").select("revenue_to_date").gte("log_date", monthStart).not("revenue_to_date","is",null);
      const {data: revToday} = await supabase.from("call_center_logs").select("revenue_to_date").eq("log_date", today).not("revenue_to_date","is",null);
      const revenueMonth = ((revMonth||[]) as {revenue_to_date:number}[]).reduce((s,r)=>s+(r.revenue_to_date||0),0);
      const revenueToday = ((revToday||[]) as {revenue_to_date:number}[]).reduce((s,r)=>s+(r.revenue_to_date||0),0);

      setStats({
        leadsToday:leadsToday||0, leadsMonth:leadsMonth||0, leadsTotal:leadsTotal||0,
        apptToday:apptToday||0, apptMonth:apptMonth||0, apptTotal:apptTotal||0,
        noShowToday:0, noShowMonth:noShowMonth||0, noShowTotal:noShowTotal||0,
        revenueToday, revenueMonth, revenueTotal,
        fbTotal:fbTotal||0, fbMonth:fbMonth||0,
        woundNoAppt:woundNoAppt||0, screeningNoAppt:screeningNoAppt||0,
        pendingCallbacks:pendingCallbacks||0,
      });

      // Monthly trend (last 12 months)
      const {data: monthly} = await supabase.rpc
        ? await supabase.from("call_center_logs")
            .select("log_date, appointment_status, appointment_final_status")
            .not("log_date","is",null)
            .gte("log_date","2025-07-01")
        : {data:[]};

      if (monthly) {
        const byMonth: Record<string,{leads:number;appointments:number;no_shows:number}> = {};
        (monthly as {log_date:string;appointment_status:string;appointment_final_status:string}[]).forEach(r => {
          const m = r.log_date.slice(0,7);
          if (!byMonth[m]) byMonth[m]={leads:0,appointments:0,no_shows:0};
          byMonth[m].leads++;
          if (r.appointment_status==="Appointment done") byMonth[m].appointments++;
          if (r.appointment_final_status==="No Show") byMonth[m].no_shows++;
        });
        setMonthlyData(
          Object.entries(byMonth)
            .sort(([a],[b])=>a.localeCompare(b))
            .map(([month,v])=>({
              month: new Date(month+"-01").toLocaleDateString("en-GB",{month:"short",year:"2-digit"}),
              ...v
            }))
        );
      }

      // Source breakdown
      const {data: srcData} = await supabase.from("call_center_logs").select("call_source").not("call_source","is",null);
      const srcCounts: Record<string,number> = {};
      (srcData||[]).forEach((r:{call_source:string})=>{srcCounts[r.call_source]=(srcCounts[r.call_source]||0)+1;});
      setSourceData(Object.entries(srcCounts).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value));

      // Doctor breakdown
      const {data: drData} = await supabase.from("call_center_logs").select("doctor_name_raw").not("doctor_name_raw","is",null).eq("appointment_status","Appointment done");
      const drCounts: Record<string,number> = {};
      (drData||[]).forEach((r:{doctor_name_raw:string})=>{drCounts[r.doctor_name_raw]=(drCounts[r.doctor_name_raw]||0)+1;});
      setDoctorData(Object.entries(drCounts).map(([name,count])=>({name:name.replace(/^(Dr\.|Prof\. Dr\.)\s*/,""),count})).sort((a,b)=>b.count-a.count).slice(0,8));

      // Final status
      const {data: fsData} = await supabase.from("call_center_logs").select("appointment_final_status").not("appointment_final_status","is",null);
      const fsCounts: Record<string,number> = {};
      (fsData||[]).forEach((r:{appointment_final_status:string})=>{fsCounts[r.appointment_final_status]=(fsCounts[r.appointment_final_status]||0)+1;});
      setFinalStatusData(Object.entries(fsCounts).map(([name,value])=>({name,value})));

      setLoading(false);
    }
    load();
  }, [today, monthStart]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <span className="text-sm text-gray-500">
          {new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
        </span>
      </div>

      {/* KPI Cards */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array(6).fill(0).map((_,i)=><div key={i} className="h-28 bg-gray-200 rounded-xl animate-pulse"/>)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard label="Total Leads" icon="📞" color="blue" today={stats.leadsToday} month={stats.leadsMonth} total={stats.leadsTotal}/>
          <StatCard label="Appointments" icon="✅" color="green" today={stats.apptToday} month={stats.apptMonth} total={stats.apptTotal}/>
          <StatCard label="No Shows" icon="🚫" color="red" today={stats.noShowToday} month={stats.noShowMonth} total={stats.noShowTotal}/>
          <StatCard label="Facebook Leads" icon="📘" color="blue" today={0} month={stats.fbMonth} total={stats.fbTotal}/>
          <StatCard label="Revenue" icon="💰" color="emerald" today={stats.revenueToday} month={stats.revenueMonth} total={stats.revenueTotal} isCurrency/>
          <StatCard label="Pending Callbacks" icon="🔁" color="orange" today={0} month={0} total={stats.pendingCallbacks}/>
        </div>
      )}

      {/* Alert row */}
      {!loading && (stats.woundNoAppt > 0 || stats.screeningNoAppt > 0) && (
        <div className="flex gap-3">
          {stats.woundNoAppt > 0 && (
            <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-4 py-2 text-sm text-orange-700">
              🩹 <strong>{stats.woundNoAppt}</strong> wound leads with no appointment
            </div>
          )}
          {stats.screeningNoAppt > 0 && (
            <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-lg px-4 py-2 text-sm text-purple-700">
              🔬 <strong>{stats.screeningNoAppt}</strong> screening leads with no appointment
            </div>
          )}
        </div>
      )}

      {/* Monthly Trend — full width */}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold text-gray-700 mb-4">Monthly Trend — Leads, Appointments & No Shows</h2>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={monthlyData} margin={{top:5,right:10,left:0,bottom:0}}>
            <defs>
              <linearGradient id="gLeads" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.15}/>
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="gAppt" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10B981" stopOpacity={0.15}/>
                <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
            <XAxis dataKey="month" tick={{fontSize:11}} />
            <YAxis tick={{fontSize:11}}/>
            <Tooltip/>
            <Legend iconSize={10} wrapperStyle={{fontSize:12}}/>
            <Area type="monotone" dataKey="leads" stroke="#3B82F6" fill="url(#gLeads)" strokeWidth={2} name="Leads"/>
            <Area type="monotone" dataKey="appointments" stroke="#10B981" fill="url(#gAppt)" strokeWidth={2} name="Appointments"/>
            <Line type="monotone" dataKey="no_shows" stroke="#EF4444" strokeWidth={2} dot={false} name="No Shows"/>
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* 3-column charts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white rounded-xl border p-5 md:col-span-2">
          <h2 className="font-semibold text-gray-700 mb-4">Appointments by Doctor (All Time)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={doctorData} layout="vertical" margin={{left:10}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis type="number" tick={{fontSize:11}}/>
              <YAxis dataKey="name" type="category" width={140} tick={{fontSize:11}}/>
              <Tooltip/>
              <Bar dataKey="count" fill="#3B82F6" radius={[0,4,4,0]} name="Appointments"/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-700 mb-4">Final Status</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={finalStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={false}>
                {finalStatusData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
              </Pie>
              <Tooltip/>
              <Legend iconSize={10} wrapperStyle={{fontSize:11}}/>
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border p-5 md:col-span-3">
          <h2 className="font-semibold text-gray-700 mb-4">Leads by Source (All Time)</h2>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={sourceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="name" tick={{fontSize:11}}/>
              <YAxis tick={{fontSize:11}}/>
              <Tooltip/>
              <Bar dataKey="value" fill="#10B981" radius={[4,4,0,0]} name="Leads"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

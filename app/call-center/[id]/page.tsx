"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useDropdowns } from "@/lib/useDropdowns";
import { formatDate, formatPhone, getStatusColor, formatCurrency } from "@/lib/utils";
import type { CallCenterLog } from "@/types";

export default function LeadDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [log, setLog] = useState<CallCenterLog | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<CallCenterLog>>({});
  const [saving, setSaving] = useState(false);
  const { dropdowns } = useDropdowns();

  useEffect(() => {
    supabase.from("call_center_logs").select("*").eq("id", id).single().then(({ data }) => {
      if (data) { setLog(data); setForm(data); }
    });
  }, [id]);

  const save = async () => {
    setSaving(true);
    const res = await fetch("/api/call-center/update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: Number(id), ...form }),
    });
    if (res.ok) { const d = await res.json(); setLog(d.data); setEditing(false); }
    setSaving(false);
  };

  if (!log) return <div className="text-center py-16 text-gray-400">Loading…</div>;

  const F = ({ label, value, field, type = "text", options }: { label: string; value: React.ReactNode; field?: keyof CallCenterLog; type?: string; options?: { label: string; value: string }[] }) => (
    <div className="py-2 border-b border-gray-100 last:border-0">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      {editing && field ? (
        options ? (
          <select className="border rounded px-2 py-1 text-sm w-full" value={String(form[field] || "")} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}>
            <option value="">— None —</option>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : type === "textarea" ? (
          <textarea className="border rounded px-2 py-1 text-sm w-full" rows={3} value={String(form[field] || "")} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} />
        ) : (
          <input type={type} className="border rounded px-2 py-1 text-sm w-full" value={String(form[field] || "")} onChange={e => setForm(f => ({ ...f, [field]: type === "number" ? parseFloat(e.target.value) : e.target.value }))} />
        )
      ) : (
        <div className="text-sm font-medium text-gray-800">{value || "—"}</div>
      )}
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
          <h1 className="text-xl font-bold text-gray-900">{log.patient_name}</h1>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(log.appointment_status)}`}>{log.appointment_status}</span>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <button onClick={save} disabled={saving} className="bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
              <button onClick={() => { setForm(log); setEditing(false); }} className="bg-gray-200 text-gray-700 px-4 py-1.5 rounded-lg text-sm hover:bg-gray-300">Cancel</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-blue-700">Edit</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">Patient Information</h2>
          <F label="Full Name" value={log.patient_name} field="patient_name" />
          <F label="Patient ID" value={log.patient_id_raw} field="patient_id_raw" />
          <F label="Phone" value={formatPhone(log.mobile_normalised)} field="mobile_raw" />
          <F label="Normalized Phone" value={log.mobile_normalised} />
          <F label="Location" value={log.location} field="location" />
          <F label="Age" value={log.patient_age} field="patient_age" type="number" />
          <F label="Patient Type" value={<span className={`px-1.5 py-0.5 rounded text-xs font-medium ${log.patient_type === "new" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>{log.patient_type}</span>} field="patient_type" options={dropdowns.patientNewOld} />
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">Call Information</h2>
          <F label="Date" value={formatDate(log.log_date)} field="log_date" type="date" />
          <F label="Call Category" value={log.call_category} field="call_category" options={dropdowns.callCategories} />
          <F label="Source" value={log.call_source} field="call_source" options={dropdowns.sources} />
          <F label="Ad Campaign" value={log.ad_campaign} field="ad_campaign" options={dropdowns.adCampaigns} />
          <F label="Call Center Person" value={log.call_center_person} field="call_center_person" options={dropdowns.agents} />
          <F label="Lead Source" value={log.lead_source} />
          <F label="Sheet Tab" value={log.sheet_tab} />
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">Appointment</h2>
          <F label="Appointment Status" value={<span className={`px-1.5 py-0.5 rounded text-xs font-medium ${getStatusColor(log.appointment_status)}`}>{log.appointment_status}</span>} field="appointment_status" options={dropdowns.appointmentStatuses} />
          <F label="Doctor" value={log.doctor_name_raw} field="doctor_name_raw" options={dropdowns.doctors} />
          <F label="Appointment Date" value={formatDate(log.appointment_date || null)} field="appointment_date" type="date" />
          <F label="Appointment Time" value={log.appointment_time} field="appointment_time" options={dropdowns.timeSlots} />
          <F label="Final Status" value={<span className={`px-1.5 py-0.5 rounded text-xs font-medium ${getStatusColor(log.appointment_final_status)}`}>{log.appointment_final_status}</span>} field="appointment_final_status" options={dropdowns.finalStatuses} />
          <F label="Revenue to Date" value={formatCurrency(log.revenue_to_date)} field="revenue_to_date" type="number" />
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">Lead & Follow-Up</h2>
          <F label="Lead Category" value={log.lead_category} field="lead_category" options={dropdowns.leadCategories} />
          <F label="Internal Category" value={log.internal_lead_category} field="internal_lead_category" options={dropdowns.internalLeadCategories} />
          <F label="Priority" value={log.priority} field="priority" options={dropdowns.priorities} />
          <F label="Follow-Up Required" value={log.followup_required ? "Yes" : "No"} />
          <F label="Follow-Up Count" value={`${log.followup_count} / ${log.max_followups}`} />
          <F label="Next Follow-Up Date" value={formatDate(log.next_followup_date)} field="next_followup_date" type="date" />
          <F label="Last Outcome" value={log.last_call_outcome} />
          <F label="Comments" value={log.comments} field="comments" type="textarea" />
        </div>
      </div>

      <div className="text-xs text-gray-400 text-right">
        Created: {formatDate(log.created_at)} · Updated: {formatDate(log.updated_at)} · ID: #{log.id}
      </div>
    </div>
  );
}

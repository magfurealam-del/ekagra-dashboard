"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDropdowns } from "@/lib/useDropdowns";
import { normalizeBDPhone, getToday } from "@/lib/utils";

interface FormData {
  patient_name: string; mobile_raw: string; patient_id_raw: string;
  location: string; patient_age: string; patient_type: string;
  log_date: string; call_category: string; call_source: string;
  ad_campaign: string; call_center_person: string;
  appointment_status: string; doctor_name_raw: string;
  appointment_date: string; appointment_time: string;
  appointment_final_status: string; lead_category: string;
  internal_lead_category: string; comments: string;
  followup_required: boolean; next_followup_date: string; priority: string;
}

const initial: FormData = {
  patient_name: "", mobile_raw: "", patient_id_raw: "", location: "",
  patient_age: "", patient_type: "new", log_date: getToday(),
  call_category: "", call_source: "", ad_campaign: "", call_center_person: "",
  appointment_status: "", doctor_name_raw: "", appointment_date: "",
  appointment_time: "", appointment_final_status: "", lead_category: "",
  internal_lead_category: "", comments: "", followup_required: false,
  next_followup_date: "", priority: "medium",
};

export default function NewLeadPage() {
  const router = useRouter();
  const { dropdowns, loading } = useDropdowns();
  const [form, setForm] = useState<FormData>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const set = (key: keyof FormData, value: string | boolean) =>
    setForm(f => ({ ...f, [key]: value }));

  const normalizedPhone = normalizeBDPhone(form.mobile_raw);
  const needsApptDetails = form.appointment_status === "Appointment done";
  const isNoShow = form.appointment_final_status === "No Show";
  const isWoundOrScreening = ["wound", "screening"].includes(form.internal_lead_category);

  const validate = () => {
    if (!form.patient_name.trim()) return "Patient name is required";
    if (!form.log_date) return "Date is required";
    if (form.mobile_raw && !normalizedPhone) return "Invalid phone number format";
    if (needsApptDetails && !form.appointment_date) return "Appointment date required when appointment is done";
    if (needsApptDetails && !form.doctor_name_raw) return "Doctor name required when appointment is done";
    return "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }
    setSaving(true); setError("");

    const payload = {
      ...form,
      mobile_normalised: normalizedPhone || form.mobile_raw,
      followup_required: form.followup_required || isNoShow || (isWoundOrScreening && !form.appointment_date),
    };

    const res = await fetch("/api/call-center/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setSuccess(true);
    } else {
      const d = await res.json();
      setError(d.error || "Failed to save. Please try again.");
    }
    setSaving(false);
  };

  if (success) {
    return (
      <div className="max-w-lg mx-auto text-center py-16 space-y-4">
        <div className="text-5xl">✅</div>
        <h2 className="text-xl font-semibold text-gray-900">Lead saved successfully!</h2>
        <div className="flex gap-3 justify-center">
          <button onClick={() => { setForm(initial); setSuccess(false); }} className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700">+ Add Another</button>
          <button onClick={() => router.push("/call-center")} className="bg-gray-200 text-gray-700 px-5 py-2 rounded-lg hover:bg-gray-300">View All Logs</button>
        </div>
      </div>
    );
  }

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="bg-white rounded-xl border p-5 space-y-4">
      <h2 className="font-semibold text-gray-800 text-sm uppercase tracking-wide border-b pb-2">{title}</h2>
      {children}
    </div>
  );

  const Field = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      {children}
    </div>
  );

  const inputCls = "w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
  const selectCls = inputCls;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
        <h1 className="text-2xl font-bold text-gray-900">New Lead</h1>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading dropdowns…</div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Section title="1. Patient Basics">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Patient Name" required>
                <input className={inputCls} value={form.patient_name} onChange={e => set("patient_name", e.target.value)} placeholder="Full name" />
              </Field>
              <Field label="Mobile Number">
                <input className={inputCls} value={form.mobile_raw} onChange={e => set("mobile_raw", e.target.value)} placeholder="01XXXXXXXXX" />
                {form.mobile_raw && (
                  <p className={`text-xs mt-0.5 ${normalizedPhone ? "text-green-600" : "text-red-500"}`}>
                    {normalizedPhone ? `✓ ${normalizedPhone}` : "⚠ Invalid number"}
                  </p>
                )}
              </Field>
              <Field label="Patient ID (HN)">
                <input className={inputCls} value={form.patient_id_raw} onChange={e => set("patient_id_raw", e.target.value)} placeholder="Hospital number" />
              </Field>
              <Field label="Location">
                <input className={inputCls} value={form.location} onChange={e => set("location", e.target.value)} placeholder="Area / district" />
              </Field>
              <Field label="Age">
                <input className={inputCls} type="number" value={form.patient_age} onChange={e => set("patient_age", e.target.value)} placeholder="Years" />
              </Field>
              <Field label="New / Old Patient">
                <select className={selectCls} value={form.patient_type} onChange={e => set("patient_type", e.target.value)}>
                  {dropdowns.patientNewOld.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
            </div>
          </Section>

          <Section title="2. Call Information">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Date" required>
                <div className="flex gap-2">
                  <input className={inputCls} type="date" value={form.log_date} onChange={e => set("log_date", e.target.value)} />
                </div>
                <div className="flex gap-1 mt-1">
                  {[["Today", getToday()], ["Yesterday", new Date(Date.now()-86400000).toISOString().split("T")[0]]].map(([l, v]) => (
                    <button key={l} type="button" onClick={() => set("log_date", v)} className="text-xs px-2 py-0.5 border rounded hover:bg-gray-50">{l}</button>
                  ))}
                </div>
              </Field>
              <Field label="Call Category">
                <select className={selectCls} value={form.call_category} onChange={e => set("call_category", e.target.value)}>
                  <option value="">— Select —</option>
                  {dropdowns.callCategories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Source of Appointment">
                <select className={selectCls} value={form.call_source} onChange={e => set("call_source", e.target.value)}>
                  <option value="">— Select —</option>
                  {dropdowns.sources.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Ad Campaign">
                <select className={selectCls} value={form.ad_campaign} onChange={e => set("ad_campaign", e.target.value)}>
                  <option value="">— None —</option>
                  {dropdowns.adCampaigns.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </Field>
              <Field label="Call Center Person">
                <select className={selectCls} value={form.call_center_person} onChange={e => set("call_center_person", e.target.value)}>
                  <option value="">— Select —</option>
                  {dropdowns.agents.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </Field>
            </div>
          </Section>

          <Section title="3. Appointment Information">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Appointment Status">
                <select className={selectCls} value={form.appointment_status} onChange={e => set("appointment_status", e.target.value)}>
                  <option value="">— Select —</option>
                  {dropdowns.appointmentStatuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Doctor" required={needsApptDetails}>
                <select className={selectCls} value={form.doctor_name_raw} onChange={e => set("doctor_name_raw", e.target.value)}>
                  <option value="">— Select doctor —</option>
                  {dropdowns.doctors.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </Field>
              <Field label={`Appointment Date${needsApptDetails ? " *" : ""}`}>
                <input className={inputCls} type="date" value={form.appointment_date} onChange={e => set("appointment_date", e.target.value)} />
                {!needsApptDetails && <p className="text-xs text-gray-400 mt-0.5">Optional unless appointment booked</p>}
              </Field>
              <Field label="Appointment Time">
                <select className={selectCls} value={form.appointment_time} onChange={e => set("appointment_time", e.target.value)} disabled={!needsApptDetails}>
                  <option value="">— Select time —</option>
                  {dropdowns.timeSlots.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Final Status">
                <select className={selectCls} value={form.appointment_final_status} onChange={e => set("appointment_final_status", e.target.value)}>
                  <option value="">— Select —</option>
                  {dropdowns.finalStatuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
            </div>
            {isNoShow && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                ⚠ No Show detected — a callback task will be automatically created after saving.
              </div>
            )}
          </Section>

          <Section title="4. Lead Category">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Lead Category">
                <select className={selectCls} value={form.lead_category} onChange={e => set("lead_category", e.target.value)}>
                  <option value="">— Select —</option>
                  {dropdowns.leadCategories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Internal Category">
                <select className={selectCls} value={form.internal_lead_category} onChange={e => set("internal_lead_category", e.target.value)}>
                  <option value="">— Select —</option>
                  {dropdowns.internalLeadCategories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
            </div>
            {isWoundOrScreening && !form.appointment_date && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-700">
                ℹ Wound/Screening lead without appointment — will be flagged for follow-up.
              </div>
            )}
          </Section>

          <Section title="5. Notes & Follow-Up">
            <Field label="Comments">
              <textarea className={inputCls} rows={3} value={form.comments} onChange={e => set("comments", e.target.value)} placeholder="Any notes about this call…" />
            </Field>
            <div className="grid grid-cols-3 gap-4">
              <Field label="">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.followup_required} onChange={e => set("followup_required", e.target.checked)} className="rounded" />
                  <span className="text-sm">Needs follow-up</span>
                </label>
              </Field>
              {form.followup_required && (
                <>
                  <Field label="Next Follow-Up Date">
                    <input className={inputCls} type="date" value={form.next_followup_date} onChange={e => set("next_followup_date", e.target.value)} />
                  </Field>
                  <Field label="Priority">
                    <select className={selectCls} value={form.priority} onChange={e => set("priority", e.target.value)}>
                      {dropdowns.priorities.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </Field>
                </>
              )}
            </div>
          </Section>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <div className="flex gap-3 pb-6">
            <button type="submit" disabled={saving} className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {saving ? "Saving…" : "Save Lead"}
            </button>
            <button type="button" onClick={() => router.back()} className="bg-gray-200 text-gray-700 px-6 py-2.5 rounded-lg hover:bg-gray-300">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

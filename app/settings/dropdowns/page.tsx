"use client";
import { useState, useEffect } from "react";
import type { LookupItem } from "@/types";
import { supabase } from "@/lib/supabase";

const TABLES: { key: string; label: string }[] = [
  { key: "lookup_doctors", label: "Doctors" },
  { key: "lookup_call_categories", label: "Call Categories" },
  { key: "lookup_sources_of_appointment", label: "Sources of Appointment" },
  { key: "lookup_appointment_statuses", label: "Appointment Statuses" },
  { key: "lookup_final_statuses", label: "Final Statuses" },
  { key: "lookup_patient_new_old", label: "Patient New/Old" },
  { key: "lookup_lead_categories", label: "Lead Categories" },
  { key: "lookup_internal_lead_categories", label: "Internal Lead Categories" },
  { key: "lookup_call_center_agents", label: "Call Center Agents" },
  { key: "lookup_ad_campaigns", label: "Ad Campaigns" },
  { key: "lookup_call_outcomes", label: "Call Outcomes" },
  { key: "lookup_followup_priorities", label: "Follow-up Priorities" },
  { key: "lookup_appointment_time_slots", label: "Time Slots" },
];

export default function DropdownsPage() {
  const [active, setActive] = useState(TABLES[0].key);
  const [items, setItems] = useState<LookupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadItems = async (table: string) => {
    setLoading(true);
    const { data } = await supabase.from(table).select("*").order("sort_order").order("label");
    setItems(data || []);
    setLoading(false);
  };

  useEffect(() => { loadItems(active); }, [active]);

  const toggle = async (item: LookupItem) => {
    await supabase.from(active).update({ is_active: !item.is_active }).eq("id", item.id);
    loadItems(active);
  };

  const saveEdit = async (id: string) => {
    if (!editLabel.trim()) return;
    setSaving(true);
    await supabase.from(active).update({
      label: editLabel.trim(),
      value: editLabel.trim().toLowerCase().replace(/\s+/g, "_"),
    }).eq("id", id);
    setEditId(null);
    setSaving(false);
    loadItems(active);
  };

  const addItem = async () => {
    if (!newLabel.trim()) return;
    setError("");
    setSaving(true);
    const { error: err } = await supabase.from(active).insert({
      label: newLabel.trim(),
      value: newLabel.trim().toLowerCase().replace(/\s+/g, "_"),
      sort_order: 99,
      is_active: true,
    });
    if (err) setError(err.message);
    else setNewLabel("");
    setSaving(false);
    loadItems(active);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dropdown Settings</h1>
        <p className="text-sm text-gray-500">Manage all dropdown options used in call center forms</p>
      </div>

      <div className="flex gap-4 flex-col md:flex-row">
        {/* Sidebar */}
        <div className="md:w-52 shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {TABLES.map(t => (
              <button key={t.key} onClick={() => setActive(t.key)}
                className={`w-full text-left px-4 py-2.5 text-sm border-b border-gray-100 last:border-0 transition-colors ${
                  active === t.key ? "bg-teal-50 text-teal-700 font-medium" : "text-gray-700 hover:bg-gray-50"
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">{TABLES.find(t => t.key === active)?.label}</h2>
              <span className="text-xs text-gray-400">{items.length} items</span>
            </div>

            {loading ? (
              <div className="p-5 space-y-2">
                {Array(5).fill(0).map((_, i) => <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />)}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {items.map(item => (
                  <div key={item.id} className={`flex items-center gap-3 px-5 py-3 ${!item.is_active ? "opacity-40" : ""}`}>
                    {editId === item.id ? (
                      <>
                        <input value={editLabel} onChange={e => setEditLabel(e.target.value)} autoFocus
                          className="flex-1 border border-teal-400 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-teal-500 outline-none" />
                        <button onClick={() => saveEdit(item.id)} disabled={saving}
                          className="px-3 py-1.5 bg-teal-600 text-white text-xs rounded-lg hover:bg-teal-700 disabled:opacity-60">
                          Save
                        </button>
                        <button onClick={() => setEditId(null)}
                          className="px-2 py-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg">Cancel</button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-gray-800">{item.label}</span>
                        <button onClick={() => { setEditId(item.id); setEditLabel(item.label); }}
                          className="text-xs text-gray-400 hover:text-teal-600 transition-colors">Edit</button>
                        <button onClick={() => toggle(item)}
                          className={`text-xs transition-colors ${item.is_active ? "text-gray-400 hover:text-red-500" : "text-gray-400 hover:text-green-500"}`}>
                          {item.is_active ? "Disable" : "Enable"}
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add new */}
            <div className="px-5 py-4 border-t border-gray-100 bg-gray-50">
              <div className="flex gap-2">
                <input type="text" value={newLabel} onChange={e => setNewLabel(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addItem()}
                  placeholder="Add new option…"
                  className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm" />
                <button onClick={addItem} disabled={saving || !newLabel.trim()}
                  className="px-4 py-2 bg-teal-600 text-white text-sm rounded-xl hover:bg-teal-700 disabled:opacity-60">
                  {saving ? "…" : "Add"}
                </button>
              </div>
              {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

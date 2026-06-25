"use client";
import { useEffect, useState } from "react";
import type { LookupItem } from "@/types";

const TABLES = [
  { key: "lookup_doctors", label: "Doctors" },
  { key: "lookup_call_categories", label: "Call Categories" },
  { key: "lookup_sources_of_appointment", label: "Sources of Appointment" },
  { key: "lookup_appointment_statuses", label: "Appointment Statuses" },
  { key: "lookup_final_statuses", label: "Final Statuses" },
  { key: "lookup_call_center_agents", label: "Call Center Agents" },
  { key: "lookup_lead_categories", label: "Lead Categories" },
  { key: "lookup_ad_campaigns", label: "Ad Campaigns" },
  { key: "lookup_appointment_time_slots", label: "Time Slots" },
];

export default function DropdownSettingsPage() {
  const [activeTable, setActiveTable] = useState(TABLES[0].key);
  const [items, setItems] = useState<LookupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dropdowns?table=${activeTable}`)
      .then(r => r.json())
      .then(d => { setItems(d.data || []); setLoading(false); });
  }, [activeTable]);

  const addItem = async () => {
    if (!newLabel || !newValue) return;
    setSaving(true);
    const res = await fetch("/api/dropdowns/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table: activeTable, label: newLabel, value: newValue }),
    });
    if (res.ok) {
      setMsg("Added!"); setNewLabel(""); setNewValue("");
      const d = await res.json();
      setItems(prev => [...prev, d.data]);
    } else setMsg("Error adding item");
    setSaving(false);
    setTimeout(() => setMsg(""), 3000);
  };

  const toggleActive = async (item: LookupItem) => {
    const res = await fetch("/api/dropdowns/update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table: activeTable, id: item.id, is_active: !item.is_active }),
    });
    if (res.ok) setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_active: !i.is_active } : i));
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Dropdown Settings</h1>
      <p className="text-sm text-gray-500">Manage dropdown values used in forms and filters.</p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <div className="bg-white rounded-xl border p-3 space-y-1">
          {TABLES.map(t => (
            <button key={t.key} onClick={() => setActiveTable(t.key)} className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${activeTable === t.key ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700 hover:bg-gray-50"}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="md:col-span-3 space-y-4">
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
              <h2 className="font-semibold text-gray-700">{TABLES.find(t => t.key === activeTable)?.label}</h2>
              {msg && <span className="text-sm text-green-600">{msg}</span>}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Label</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Value</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Order</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? <tr><td colSpan={4} className="px-4 py-4 text-center text-gray-400">Loading…</td></tr> :
                  items.map(item => (
                    <tr key={item.id} className={`hover:bg-gray-50 ${!item.is_active ? "opacity-50" : ""}`}>
                      <td className="px-4 py-2.5 font-medium">{item.label}</td>
                      <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{item.value}</td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{item.sort_order}</td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => toggleActive(item)} className={`text-xs px-2 py-0.5 rounded ${item.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {item.is_active ? "Active" : "Inactive"}
                        </button>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl border p-4">
            <h3 className="font-semibold text-gray-700 mb-3 text-sm">Add New Option</h3>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">Display Label</label>
                <input className="border rounded-lg px-3 py-2 text-sm w-full" value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Dr. Jane Smith" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">Internal Value</label>
                <input className="border rounded-lg px-3 py-2 text-sm w-full" value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="e.g. dr_jane_smith" />
              </div>
              <button onClick={addItem} disabled={saving || !newLabel || !newValue} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

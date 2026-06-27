"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { DailyCallbackQueueItem } from "@/types";

const OUTCOMES = [
  { value: "spoke", label: "✅ Called / Spoke" },
  { value: "no_answer", label: "📵 No Answer" },
  { value: "unreachable", label: "❌ Unreachable" },
  { value: "appointment_booked", label: "🗓️ Appointment Booked" },
  { value: "rescheduled", label: "🔄 Rescheduled" },
  { value: "doctor_callback", label: "👨‍⚕️ Doctor Callback Needed" },
  { value: "not_interested", label: "🚫 Not Interested" },
  { value: "wrong_number", label: "📞 Wrong Number" },
  { value: "already_visited", label: "✔️ Already Visited" },
];

const TYPE_BADGE: Record<string, string> = {
  no_show: "bg-red-100 text-red-800",
  wound_no_appointment: "bg-orange-100 text-orange-800",
  screening_no_appointment: "bg-amber-100 text-amber-800",
  general_followup: "bg-blue-100 text-blue-800",
  doctor_callback: "bg-purple-100 text-purple-800",
};
const TYPE_LABEL: Record<string, string> = {
  no_show: "No Show", wound_no_appointment: "Wound",
  screening_no_appointment: "Screening", general_followup: "Follow-up", doctor_callback: "Dr. Callback",
};

function TaskCard({ task, onDone }: { task: DailyCallbackQueueItem; onDone: (id: string, outcome: string, notes: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!outcome) return;
    setSaving(true);
    await onDone(task.id, outcome, notes);
    setSaving(false);
  };

  return (
    <div className={`bg-white rounded-xl border shadow-sm ${task.is_overdue ? "border-red-300" : "border-gray-200"}`}>
      <div className="p-4 cursor-pointer" onClick={() => setOpen(!open)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_BADGE[task.task_type] || "bg-gray-100 text-gray-700"}`}>
                {TYPE_LABEL[task.task_type] || task.task_type}
              </span>
              {task.is_overdue && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">⚠️ Overdue {task.days_overdue}d</span>}
              {task.completed_followups > 0 && (
                <span className="text-xs text-gray-500">Follow-up {task.completed_followups + 1}/{task.max_followups}</span>
              )}
            </div>
            <div className="font-semibold text-gray-800">{task.patient_name || "Unknown"}</div>
            <div className="text-sm font-medium text-teal-700">{task.phone}</div>
            {task.doctor_name && <div className="text-xs text-gray-500 mt-0.5">Dr. {task.doctor_name}</div>}
          </div>
          <div className="text-right text-xs text-gray-500 shrink-0">
            <div>{task.relevant_date}</div>
            <div className="mt-1">{task.source_of_appointment || "—"}</div>
            <div className="mt-2">{open ? "▲" : "▼"}</div>
          </div>
        </div>
      </div>
      {open && (
        <div className="border-t border-gray-100 p-4 space-y-3">
          {task.reason && <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3"><span className="font-medium">Reason:</span> {task.reason}</div>}
          <div>
            <div className="text-xs font-medium text-gray-600 mb-2">Outcome</div>
            <div className="space-y-1.5">
              {OUTCOMES.map(o => (
                <button key={o.value} onClick={() => setOutcome(o.value)}
                  className={`w-full text-left text-sm px-3 py-2 rounded-lg border transition-colors ${
                    outcome === o.value ? "bg-teal-50 border-teal-400 text-teal-800 font-medium" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                  }`}>{o.label}</button>
              ))}
            </div>
          </div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)…"
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm resize-none" />
          <button onClick={submit} disabled={!outcome || saving}
            className="w-full py-2.5 bg-teal-600 text-white font-medium rounded-xl text-sm hover:bg-teal-700 disabled:opacity-50 transition-colors">
            {saving ? "Saving…" : "Submit Outcome"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function CallbacksPage() {
  const [tasks, setTasks] = useState<DailyCallbackQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/callbacks?limit=200${typeFilter ? `&type=${typeFilter}` : ""}`);
    const data = await res.json();
    setTasks(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [typeFilter]);

  useEffect(() => { load(); }, [load]);

  // Realtime
  useEffect(() => {
    const ch = supabase.channel("cb_page")
      .on("postgres_changes", { event: "*", schema: "public", table: "callback_tasks" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const handleDone = async (id: string, outcome: string, notes: string) => {
    await fetch("/api/callbacks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: id, outcome, notes }),
    });
    await load();
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data } = await supabase.rpc("generate_daily_callback_tasks");
      alert(`✅ Generated: ${JSON.stringify(data)}`);
      await load();
    } finally { setGenerating(false); }
  };

  const filtered = tasks.filter(t => {
    if (!search) return true;
    const q = search.toLowerCase();
    return t.patient_name?.toLowerCase().includes(q) || t.phone?.includes(q);
  });

  const byType = {
    no_show: filtered.filter(t => t.task_type === "no_show"),
    wound: filtered.filter(t => t.task_type === "wound_no_appointment"),
    screening: filtered.filter(t => t.task_type === "screening_no_appointment"),
    other: filtered.filter(t => !["no_show","wound_no_appointment","screening_no_appointment"].includes(t.task_type)),
  };

  const Bucket = ({ label, items, dot }: { label: string; items: DailyCallbackQueueItem[]; dot: string }) =>
    items.length === 0 ? null : (
      <div className="space-y-2">
        <div className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-2 ${dot}`}>
          <span className="w-2 h-2 rounded-full bg-current inline-block" />{label} ({items.length})
        </div>
        {items.map(t => <TaskCard key={t.id} task={t} onDone={handleDone} />)}
      </div>
    );

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Daily Callback Queue</h1>
          <p className="text-sm text-gray-500">{tasks.length} tasks pending</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 shadow-sm">🔄 Refresh</button>
          <button onClick={handleGenerate} disabled={generating}
            className="px-3 py-2 bg-teal-600 text-white rounded-xl text-sm font-medium hover:bg-teal-700 disabled:opacity-60 shadow-sm">
            {generating ? "Generating…" : "⚡ Generate Tasks"}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { l: "No Shows", n: byType.no_show.length, c: "text-red-600" },
          { l: "Wound", n: byType.wound.length, c: "text-orange-600" },
          { l: "Screening", n: byType.screening.length, c: "text-amber-600" },
          { l: "Other", n: byType.other.length, c: "text-blue-600" },
        ].map(s => (
          <div key={s.l} className="bg-white rounded-xl border border-gray-200 p-3 text-center shadow-sm">
            <div className={`text-2xl font-bold ${s.c}`}>{s.n}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.l}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <input type="search" placeholder="Search name or phone…" value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm" />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm">
          <option value="">All Types</option>
          <option value="no_show">No Show</option>
          <option value="wound_no_appointment">Wound</option>
          <option value="screening_no_appointment">Screening</option>
          <option value="general_followup">Follow-up</option>
        </select>
      </div>

      {/* Queue */}
      {loading ? (
        <div className="space-y-3">{Array(5).fill(0).map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-5xl mb-3">✅</div>
          <div className="text-lg font-medium">Queue empty</div>
          <div className="text-sm mt-1">Click "Generate Tasks" to populate today's queue</div>
        </div>
      ) : (
        <div className="space-y-6">
          <Bucket label="Priority 1 — No Shows" items={byType.no_show} dot="text-red-700" />
          <Bucket label="Priority 2 — Wound" items={byType.wound} dot="text-orange-700" />
          <Bucket label="Priority 3 — Screening" items={byType.screening} dot="text-amber-700" />
          <Bucket label="Other Follow-ups" items={byType.other} dot="text-blue-700" />
        </div>
      )}
    </div>
  );
}

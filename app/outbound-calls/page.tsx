"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { DailyCallbackQueueItem } from "@/types";

const QUICK = [
  { value: "no_answer", label: "📵 No Answer", cls: "border-gray-200 text-gray-700 hover:bg-gray-50" },
  { value: "spoke", label: "✅ Spoke", cls: "border-green-200 text-green-700 bg-green-50 hover:bg-green-100" },
  { value: "unreachable", label: "❌ Unreachable", cls: "border-red-200 text-red-700 hover:bg-red-50" },
  { value: "appointment_booked", label: "🗓️ Booked", cls: "border-teal-500 bg-teal-600 text-white hover:bg-teal-700" },
  { value: "not_interested", label: "🚫 Not Interested", cls: "border-gray-200 text-gray-600 hover:bg-gray-50" },
  { value: "wrong_number", label: "📞 Wrong #", cls: "border-gray-200 text-gray-600 hover:bg-gray-50" },
];

export default function OutboundCallsPage() {
  const [tasks, setTasks] = useState<DailyCallbackQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<DailyCallbackQueueItem | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sessionDone, setSessionDone] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/callbacks?limit=50");
    const data = await res.json();
    const list: DailyCallbackQueueItem[] = Array.isArray(data) ? data : [];
    setTasks(list);
    if (!current && list.length > 0) setCurrent(list[0]);
    setLoading(false);
  }, [current]);

  useEffect(() => { load(); }, []); // eslint-disable-line

  useEffect(() => {
    const ch = supabase.channel("outbound")
      .on("postgres_changes", { event: "*", schema: "public", table: "callback_tasks" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const submit = async (outcome: string) => {
    if (!current) return;
    setSubmitting(true);
    await fetch("/api/callbacks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: current.id, outcome, notes }),
    });
    setNotes("");
    setSessionDone(n => n + 1);
    // Move to next
    const idx = tasks.findIndex(t => t.id === current.id);
    const next = tasks[idx + 1] || null;
    setCurrent(next);
    await load();
    setSubmitting(false);
  };

  const skip = () => {
    if (!current) return;
    const idx = tasks.findIndex(t => t.id === current.id);
    setCurrent(tasks[idx + 1] || null);
  };

  const task = current;

  return (
    <div className="space-y-5 max-w-xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Outbound Calls</h1>
          <p className="text-sm text-gray-500">
            {tasks.length} remaining · {sessionDone} done this session
          </p>
        </div>
        <button onClick={load} className="p-2 bg-white border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 shadow-sm">🔄</button>
      </div>

      {sessionDone > 0 && (
        <div className="flex items-center gap-3 p-4 bg-teal-50 border border-teal-200 rounded-xl">
          <span className="text-2xl">✅</span>
          <div>
            <div className="font-semibold text-teal-800">{sessionDone} calls completed</div>
            <div className="text-sm text-teal-600">{tasks.length} left in queue</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-64 bg-gray-100 rounded-2xl animate-pulse" />
      ) : !task ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="text-5xl mb-4">🎉</div>
          <div className="text-xl font-bold text-gray-800">Queue complete!</div>
          <div className="text-gray-500 mt-1 text-sm">All callbacks are done for today.</div>
          <button onClick={load} className="mt-5 px-5 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-medium hover:bg-teal-700">
            Check for new tasks
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Patient info */}
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    task.task_type === "no_show" ? "bg-red-100 text-red-700"
                    : task.task_type === "wound_no_appointment" ? "bg-orange-100 text-orange-700"
                    : task.task_type === "screening_no_appointment" ? "bg-amber-100 text-amber-700"
                    : "bg-blue-100 text-blue-700"
                  }`}>{task.priority_label || task.task_type}</span>
                  {task.is_overdue && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">⚠️ Overdue</span>}
                </div>
                <h2 className="text-xl font-bold text-gray-900">{task.patient_name || "Unknown"}</h2>
                {task.lead_category && <p className="text-sm text-gray-500">{task.lead_category}</p>}
              </div>
              {task.completed_followups > 0 && (
                <div className="text-right shrink-0">
                  <div className="text-xs text-gray-400">Follow-up</div>
                  <div className="text-xl font-bold text-gray-700">{task.completed_followups + 1}/{task.max_followups}</div>
                </div>
              )}
            </div>

            {/* Tap-to-call */}
            <a href={`tel:${task.normalized_phone || task.phone}`}
              className="flex items-center gap-3 p-4 bg-teal-600 text-white rounded-2xl hover:bg-teal-700 transition-colors">
              <span className="text-2xl">📞</span>
              <div>
                <div className="font-bold text-lg">{task.phone || task.normalized_phone || "—"}</div>
                <div className="text-teal-100 text-sm">Tap to call</div>
              </div>
            </a>

            {/* Context grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              {task.doctor_name && (
                <div className="bg-gray-50 rounded-xl p-3">
                  <div className="text-gray-400 mb-0.5">Doctor</div>
                  <div className="font-medium text-gray-700">{task.doctor_name}</div>
                </div>
              )}
              {task.relevant_date && (
                <div className="bg-gray-50 rounded-xl p-3">
                  <div className="text-gray-400 mb-0.5">Date</div>
                  <div className="font-medium text-gray-700">{task.relevant_date}</div>
                </div>
              )}
              {task.source_of_appointment && (
                <div className="bg-gray-50 rounded-xl p-3">
                  <div className="text-gray-400 mb-0.5">Source</div>
                  <div className="font-medium text-gray-700">{task.source_of_appointment}</div>
                </div>
              )}
              {task.reason && (
                <div className="bg-gray-50 rounded-xl p-3 col-span-2">
                  <div className="text-gray-400 mb-0.5">Reason</div>
                  <div className="font-medium text-gray-700">{task.reason}</div>
                </div>
              )}
            </div>
          </div>

          {/* Outcomes */}
          <div className="border-t border-gray-100 p-5 space-y-3">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Call Outcome</div>
            <div className="grid grid-cols-2 gap-2">
              {QUICK.map(o => (
                <button key={o.value} onClick={() => submit(o.value)} disabled={submitting}
                  className={`py-3 rounded-xl text-sm font-medium border transition-all disabled:opacity-50 ${o.cls}`}>
                  {o.label}
                </button>
              ))}
            </div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Notes (optional)…"
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm resize-none" />
            <button onClick={skip}
              className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Skip → Next
            </button>
          </div>
        </div>
      )}

      {/* Up next */}
      {tasks.length > 1 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Up Next</div>
          {tasks.filter(t => t.id !== task?.id).slice(0, 5).map(t => (
            <button key={t.id} onClick={() => setCurrent(t)}
              className="w-full text-left bg-white rounded-xl border border-gray-200 p-3 hover:border-teal-300 shadow-sm transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-gray-800 text-sm">{t.patient_name}</div>
                  <div className="text-xs text-gray-500">{t.phone}</div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  t.task_type === "no_show" ? "bg-red-100 text-red-700"
                  : t.task_type === "wound_no_appointment" ? "bg-orange-100 text-orange-700"
                  : "bg-blue-100 text-blue-700"}`}>
                  {t.priority_label || t.task_type}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { formatDate, formatPhone } from "@/lib/utils";
import type { CallbackTask } from "@/types";

const OUTCOMES = [
  { value: "spoke", label: "✅ Called / Spoke" },
  { value: "no_answer", label: "📵 No Answer" },
  { value: "unreachable", label: "🚫 Unreachable" },
  { value: "appointment_booked", label: "📅 Appointment Booked" },
  { value: "rescheduled", label: "🔄 Rescheduled" },
  { value: "doctor_callback", label: "👨‍⚕️ Doctor Callback Needed" },
  { value: "not_interested", label: "❌ Not Interested" },
  { value: "wrong_number", label: "📞 Wrong Number" },
  { value: "already_visited", label: "🏥 Already Visited" },
];

const TASK_PRIORITY_LABELS: Record<number, string> = { 1: "🔴 No Show", 2: "🟠 Wound — No Appt", 3: "🟡 Screening — No Appt", 4: "🔵 General Follow-up" };

export default function OutboundCallsPage() {
  const [tasks, setTasks] = useState<CallbackTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTask, setActiveTask] = useState<CallbackTask | null>(null);
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchTasks = useCallback(async () => {
    const { data } = await supabase
      .from("callback_tasks")
      .select("*")
      .eq("status", "pending")
      .order("priority_rank", { ascending: true })
      .order("due_at", { ascending: true })
      .limit(30);
    setTasks(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const handleAction = async () => {
    if (!activeTask || !outcome) return;
    setSubmitting(true);
    await fetch("/api/callbacks/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: activeTask.id, outcome, notes, nextFollowupAt: nextDate || null }),
    });
    setActiveTask(null); setOutcome(""); setNotes(""); setNextDate("");
    await fetchTasks();
    setSubmitting(false);
  };

  const closingOutcomes = ["not_interested", "wrong_number", "already_visited", "appointment_booked"];
  const isClosing = closingOutcomes.includes(outcome);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Outbound Call Queue</h1>
        <div className="text-sm text-gray-500">{tasks.length} pending tasks</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Task List */}
        <div className="md:col-span-2 space-y-2">
          {loading ? (
            Array(5).fill(0).map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)
          ) : tasks.length === 0 ? (
            <div className="bg-white rounded-xl border p-8 text-center text-gray-400">
              <div className="text-3xl mb-2">🎉</div>
              No pending outbound calls!
            </div>
          ) : tasks.map(task => (
            <div
              key={task.id}
              onClick={() => { setActiveTask(task); setOutcome(""); setNotes(""); setNextDate(""); }}
              className={`bg-white rounded-xl border p-4 cursor-pointer hover:border-blue-300 transition-colors ${activeTask?.id === task.id ? "border-blue-500 bg-blue-50" : ""}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-gray-500">{TASK_PRIORITY_LABELS[task.priority_rank] || "Follow-up"}</span>
                    <span className="text-xs text-gray-400">#{task.followup_number} of {task.max_followups}</span>
                  </div>
                  <div className="font-semibold text-gray-900">{task.patient_name || "Unknown"}</div>
                  <div className="text-sm text-blue-600">{formatPhone(task.phone)}</div>
                </div>
                <div className="text-right text-xs text-gray-500">
                  <div>Due: {formatDate(task.due_at?.split("T")[0] || null)}</div>
                  {task.lead_category && <div className="mt-1 px-1.5 py-0.5 bg-gray-100 rounded">{task.lead_category}</div>}
                </div>
              </div>
              {task.reason && <div className="text-xs text-gray-500 mt-2 border-t pt-2">{task.reason}</div>}
              {task.last_outcome && <div className="text-xs text-gray-400 mt-1">Last: {task.last_outcome}</div>}
            </div>
          ))}
        </div>

        {/* Action Panel */}
        <div className="bg-white rounded-xl border p-5 h-fit sticky top-20">
          {!activeTask ? (
            <div className="text-center text-gray-400 py-8">
              <div className="text-3xl mb-2">☎️</div>
              Select a task to log a call
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="font-semibold text-gray-900">{activeTask.patient_name}</div>
                <div className="text-blue-600 text-sm">{formatPhone(activeTask.phone)}</div>
                <div className="text-xs text-gray-500 mt-1">{activeTask.reason}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Call Outcome *</label>
                <div className="space-y-1">
                  {OUTCOMES.map(o => (
                    <label key={o.value} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer border text-sm ${outcome === o.value ? "bg-blue-50 border-blue-300" : "hover:bg-gray-50 border-transparent"}`}>
                      <input type="radio" name="outcome" value={o.value} checked={outcome === o.value} onChange={() => setOutcome(o.value)} className="text-blue-600" />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="What happened on the call…" />
              </div>
              {!isClosing && outcome && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Next Follow-Up Date</label>
                  <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={nextDate} onChange={e => setNextDate(e.target.value)} />
                </div>
              )}
              {isClosing && <div className="text-xs text-green-600 bg-green-50 px-3 py-2 rounded">This task will be closed after logging.</div>}
              <button onClick={handleAction} disabled={!outcome || submitting} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {submitting ? "Logging…" : "Log Call"}
              </button>
              <button onClick={() => setActiveTask(null)} className="w-full text-gray-500 text-sm hover:underline">Cancel</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatDate, formatPhone } from "@/lib/utils";
import type { CallbackTask } from "@/types";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700", in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700", closed: "bg-gray-100 text-gray-500",
  cancelled: "bg-red-100 text-red-700",
};

export default function CallbacksPage() {
  const [tasks, setTasks] = useState<CallbackTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending");

  useEffect(() => {
    let q = supabase.from("callback_tasks").select("*").order("priority_rank").order("due_at");
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    q.then(({ data }) => { setTasks(data || []); setLoading(false); });
  }, [statusFilter]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Callback Tasks</h1>
        <select className="border rounded-lg px-3 py-1.5 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? Array(6).fill(0).map((_, i) => <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />) :
          tasks.map(task => (
            <div key={task.id} className="bg-white rounded-xl border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[task.status]}`}>{task.status}</span>
                <span className="text-xs text-gray-400">#{task.followup_number}/{task.max_followups}</span>
              </div>
              <div>
                <div className="font-semibold text-gray-900">{task.patient_name || "Unknown"}</div>
                <div className="text-sm text-blue-600">{formatPhone(task.phone)}</div>
              </div>
              <div className="text-xs text-gray-500">{task.reason}</div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>Due: {formatDate(task.due_at?.split("T")[0] || null)}</span>
                <span>{task.task_type}</span>
              </div>
              {task.last_outcome && <div className="text-xs bg-gray-50 rounded px-2 py-1 text-gray-600">Last: {task.last_outcome}</div>}
            </div>
          ))
        }
        {!loading && tasks.length === 0 && (
          <div className="col-span-3 text-center py-12 text-gray-400">No {statusFilter} tasks</div>
        )}
      </div>
    </div>
  );
}

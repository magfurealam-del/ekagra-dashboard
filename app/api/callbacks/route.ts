import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "100");
  const taskType = searchParams.get("type") || "";
  const supabase = getServiceClient();

  let query = supabase
    .from("daily_callback_queue")
    .select("*")
    .limit(limit);

  if (taskType) query = query.eq("task_type", taskType);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  try {
    const { taskId, outcome, notes, agentName } = await req.json();
    if (!taskId || !outcome) return NextResponse.json({ error: "taskId and outcome required" }, { status: 400 });

    const supabase = getServiceClient();
    const { data: task, error: te } = await supabase.from("callback_tasks").select("*").eq("id", taskId).single();
    if (te || !task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const completedFollowups = (task.completed_followups || 0) + 1;
    const CLOSE = ["appointment_booked", "not_interested", "wrong_number", "already_visited"];
    const shouldClose = CLOSE.includes(outcome) || completedFollowups >= task.max_followups;
    const now = new Date().toISOString();
    const nextFollowupAt = shouldClose ? null : new Date(Date.now() + 7 * 86400000).toISOString();

    await supabase.from("call_interactions").insert({
      callback_task_id: taskId,
      lead_id: task.lead_id,
      patient_id: task.patient_id,
      agent_name: agentName || "agent",
      outcome,
      notes: notes || null,
      followup_number: completedFollowups,
      call_completed_at: now,
      next_followup_at: nextFollowupAt,
    });

    const update: Record<string, any> = {
      last_outcome: outcome,
      last_called_at: now,
      completed_followups: completedFollowups,
      updated_at: now,
    };
    if (shouldClose) {
      update.status = "closed";
      update.closed_at = now;
      update.closed_reason = completedFollowups >= task.max_followups ? "max_followups_completed" : outcome;
    } else {
      update.status = "followup_scheduled";
      update.next_followup_at = nextFollowupAt;
    }
    await supabase.from("callback_tasks").update(update).eq("id", taskId);

    if (task.lead_id) {
      await supabase.from("call_center_logs").update({
        last_call_outcome: outcome,
        last_followup_date: now.slice(0, 10),
        followup_count: completedFollowups,
        updated_at: now,
      }).eq("id", task.lead_id);
    }

    return NextResponse.json({ success: true, closed: shouldClose, next_followup_at: nextFollowupAt });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

const CLOSING_OUTCOMES = ["not_interested", "wrong_number", "already_visited", "appointment_booked"];

export async function POST(req: NextRequest) {
  try {
    const { taskId, outcome, notes, nextFollowupAt } = await req.json();
    if (!taskId || !outcome) return NextResponse.json({ error: "taskId and outcome required" }, { status: 400 });

    const supabase = getServiceClient();

    const { data: task } = await supabase.from("callback_tasks").select("*").eq("id", taskId).single();
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    // Log the interaction
    await supabase.from("call_interactions").insert({
      callback_task_id: taskId,
      lead_id: task.lead_id,
      agent_name: task.assigned_to,
      followup_number: task.followup_number,
      outcome,
      notes,
      call_completed_at: new Date().toISOString(),
      next_followup_at: nextFollowupAt || null,
    });

    const isClosing = CLOSING_OUTCOMES.includes(outcome) || task.followup_number >= task.max_followups;
    const newStatus = isClosing ? "closed" : "pending";
    const newFollowupNumber = task.followup_number + 1;

    await supabase.from("callback_tasks").update({
      status: newStatus,
      last_outcome: outcome,
      last_called_at: new Date().toISOString(),
      next_followup_at: nextFollowupAt || null,
      followup_number: newFollowupNumber,
      completed_followups: task.completed_followups + 1,
      closed_at: isClosing ? new Date().toISOString() : null,
      closed_reason: isClosing ? outcome : null,
      updated_at: new Date().toISOString(),
    }).eq("id", taskId);

    // Update the lead record too
    if (task.lead_id) {
      const leadUpdates: Record<string, unknown> = {
        last_call_outcome: outcome,
        last_followup_date: new Date().toISOString().split("T")[0],
        followup_count: (task.completed_followups || 0) + 1,
        updated_at: new Date().toISOString(),
      };
      if (nextFollowupAt) leadUpdates.next_followup_date = nextFollowupAt.split("T")[0];
      if (outcome === "appointment_booked") {
        leadUpdates.appointment_status = "Appointment done";
        leadUpdates.followup_required = false;
      }
      await supabase.from("call_center_logs").update(leadUpdates).eq("id", task.lead_id);
    }

    return NextResponse.json({ success: true, closed: isClosing });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

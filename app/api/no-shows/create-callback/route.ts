import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { leadId } = await req.json();
    const supabase = getServiceClient();

    const { data: lead } = await supabase.from("call_center_logs").select("*").eq("id", leadId).single();
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const { data, error } = await supabase.from("callback_tasks").insert({
      lead_id: leadId,
      patient_name: lead.patient_name,
      phone: lead.mobile_normalised,
      lead_category: lead.lead_category,
      source: lead.call_source,
      relevant_date: lead.appointment_date,
      task_type: "no_show",
      priority_rank: 1,
      reason: "No Show — follow-up call needed",
      status: "pending",
      due_at: new Date(Date.now() + 86400000).toISOString(),
      assigned_to: lead.call_center_person,
    }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

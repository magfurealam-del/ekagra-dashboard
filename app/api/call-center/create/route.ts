import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = getServiceClient();
    let lead_source = "unknown";
    if (body.call_source?.toLowerCase().includes("facebook")) lead_source = "facebook";
    else if (body.call_source?.toLowerCase().includes("referral") || body.call_source?.toLowerCase().includes("doctor")) lead_source = "referral";
    else if (body.call_source?.toLowerCase().includes("hotline") || body.call_source?.toLowerCase().includes("walk")) lead_source = "direct_call";
    const { data, error } = await supabase.from("call_center_logs").insert({
      patient_name: body.patient_name?.trim() || null,
      mobile_raw: body.mobile_raw || null,
      mobile_normalised: body.mobile_normalised || body.mobile_raw || null,
      patient_id_raw: body.patient_id_raw || null,
      location: body.location || null,
      patient_age: body.patient_age || null,
      patient_type: body.patient_type || "new",
      log_date: body.log_date || new Date().toISOString().split("T")[0],
      call_category: body.call_category || null,
      call_source: body.call_source || null,
      ad_campaign: body.ad_campaign || null,
      call_center_person: body.call_center_person || null,
      assigned_agent: body.call_center_person || null,
      appointment_status: body.appointment_status || null,
      doctor_name_raw: body.doctor_name_raw || null,
      appointment_date: body.appointment_date || null,
      appointment_time: body.appointment_time || null,
      appointment_final_status: body.appointment_final_status || null,
      lead_category: body.lead_category || null,
      internal_lead_category: body.internal_lead_category || null,
      comments: body.comments || null,
      followup_required: body.followup_required || false,
      next_followup_date: body.next_followup_date || null,
      priority: body.priority || "medium",
      lead_source,
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (body.appointment_final_status === "No Show" && data) {
      await supabase.from("callback_tasks").insert({
        lead_id: data.id, patient_name: data.patient_name, phone: data.mobile_normalised,
        lead_category: data.lead_category, source: data.call_source, relevant_date: data.appointment_date,
        task_type: "no_show", priority_rank: 1, reason: "Patient did not show for appointment",
        status: "pending", due_at: new Date(Date.now() + 86400000).toISOString(), assigned_to: data.call_center_person,
      });
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

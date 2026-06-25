import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = getServiceClient();

    const {
      patient_name, mobile_raw, mobile_normalised, patient_id_raw, location,
      patient_age, patient_type, log_date, call_category, call_source, ad_campaign,
      call_center_person, appointment_status, doctor_name_raw, appointment_date,
      appointment_time, appointment_final_status, lead_category, internal_lead_category,
      comments, followup_required, next_followup_date, priority,
    } = body;

    // Determine lead_source from call_source
    let lead_source = "unknown";
    if (call_source?.toLowerCase().includes("facebook")) lead_source = "facebook";
    else if (call_source?.toLowerCase().includes("referral") || call_source?.toLowerCase().includes("doctor")) lead_source = "referral";
    else if (call_source?.toLowerCase().includes("hotline")) lead_source = "direct_call";
    else if (call_source?.toLowerCase().includes("walk")) lead_source = "direct_call";

    const insertPayload = {
      patient_name: patient_name?.trim() || null,
      mobile_raw: mobile_raw || null,
      mobile_normalised: mobile_normalised || mobile_raw || null,
      patient_id_raw: patient_id_raw || null,
      location: location || null,
      patient_age: patient_age || null,
      patient_type: patient_type || "new",
      log_date: log_date || new Date().toISOString().split("T")[0],
      call_category: call_category || null,
      call_source: call_source || null,
      ad_campaign: ad_campaign || null,
      call_center_person: call_center_person || null,
      assigned_agent: call_center_person || null,
      appointment_status: appointment_status || null,
      doctor_name_raw: doctor_name_raw || null,
      appointment_date: appointment_date || null,
      appointment_time: appointment_time || null,
      appointment_final_status: appointment_final_status || null,
      lead_category: lead_category || null,
      internal_lead_category: internal_lead_category || null,
      comments: comments || null,
      followup_required: followup_required || false,
      next_followup_date: next_followup_date || null,
      priority: priority || "medium",
      lead_source,
    };

    const { data, error } = await supabase
      .from("call_center_logs")
      .insert(insertPayload)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // Auto-create callback for no-shows
    if (appointment_final_status === "No Show" && data) {
      await supabase.from("callback_tasks").insert({
        lead_id: data.id,
        patient_name: data.patient_name,
        phone: data.mobile_normalised,
        lead_category: data.lead_category,
        source: data.call_source,
        relevant_date: data.appointment_date,
        task_type: "no_show",
        priority_rank: 1,
        reason: "Patient did not show for appointment",
        status: "pending",
        due_at: new Date(Date.now() + 86400000).toISOString(),
        assigned_to: data.call_center_person,
      });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

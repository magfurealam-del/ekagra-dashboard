import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

const ALLOWED_TABLES = [
  "lookup_doctors", "lookup_call_categories", "lookup_sources_of_appointment",
  "lookup_appointment_statuses", "lookup_final_statuses", "lookup_patient_new_old",
  "lookup_lead_categories", "lookup_internal_lead_categories", "lookup_call_center_agents",
  "lookup_ad_campaigns", "lookup_call_outcomes", "lookup_followup_priorities",
  "lookup_appointment_time_slots",
];

export async function POST(req: NextRequest) {
  try {
    const { table, label, value, sort_order } = await req.json();
    if (!ALLOWED_TABLES.includes(table)) return NextResponse.json({ error: "Invalid table" }, { status: 400 });
    const supabase = getServiceClient();
    const { data, error } = await supabase.from(table).insert({ label, value, sort_order: sort_order || 99 }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { table, id, ...updates } = await req.json();
    if (!ALLOWED_TABLES.includes(table)) return NextResponse.json({ error: "Invalid table" }, { status: 400 });
    const supabase = getServiceClient();
    const { data, error } = await supabase.from(table).update(updates).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ data });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

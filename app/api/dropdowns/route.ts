import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

const ALLOWED_TABLES = [
  "lookup_doctors", "lookup_call_categories", "lookup_sources_of_appointment",
  "lookup_appointment_statuses", "lookup_final_statuses", "lookup_patient_new_old",
  "lookup_lead_categories", "lookup_internal_lead_categories", "lookup_call_center_agents",
  "lookup_ad_campaigns", "lookup_call_outcomes", "lookup_followup_priorities",
  "lookup_appointment_time_slots",
];

export async function GET(req: NextRequest) {
  const table = req.nextUrl.searchParams.get("table");
  if (!table || !ALLOWED_TABLES.includes(table)) {
    return NextResponse.json({ error: "Invalid table" }, { status: 400 });
  }
  const supabase = getServiceClient();
  const { data, error } = await supabase.from(table).select("*").order("sort_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

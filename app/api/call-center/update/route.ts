import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const supabase = getServiceClient();
    delete updates.id; delete updates.created_at; delete updates.mobile_e164;
    const { data, error } = await supabase
      .from("call_center_logs")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ data });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

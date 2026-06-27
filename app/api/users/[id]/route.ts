import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const allowed = ["role", "is_active", "full_name"];
    const updates = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    updates.updated_at = new Date().toISOString();
    const supabase = getServiceClient();
    const { data, error } = await supabase.from("user_profiles").update(updates).eq("id", id).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

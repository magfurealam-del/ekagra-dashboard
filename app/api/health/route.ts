import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "MISSING";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "MISSING";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "MISSING";

  let dbStatus = "untested";
  let rowCount = 0;
  try {
    const supabase = getServiceClient();
    const { count, error } = await supabase
      .from("call_center_logs")
      .select("*", { count: "exact", head: true });
    dbStatus = error ? `error: ${error.message}` : "connected";
    rowCount = count || 0;
  } catch (e) {
    dbStatus = `exception: ${String(e)}`;
  }

  return NextResponse.json({
    supabase_url: url,
    anon_key_present: anonKey !== "MISSING",
    anon_key_prefix: anonKey !== "MISSING" ? anonKey.slice(0, 25) + "..." : "MISSING",
    service_key_present: serviceKey !== "MISSING",
    service_key_prefix: serviceKey !== "MISSING" ? serviceKey.slice(0, 15) + "..." : "MISSING",
    db_connection: dbStatus,
    db_row_count: rowCount,
    timestamp: new Date().toISOString(),
  });
}
// build-1782409946

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") || "month";
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");

  const nowDhaka = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const todayStr = nowDhaka.toISOString().slice(0, 10);
  let startDate: string;
  let endDate = todayStr;

  if (period === "today") {
    startDate = todayStr;
  } else if (period === "week") {
    const day = nowDhaka.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const mon = new Date(nowDhaka);
    mon.setDate(mon.getDate() - diff);
    startDate = mon.toISOString().slice(0, 10);
  } else if (period === "custom" && startParam && endParam) {
    startDate = startParam;
    endDate = endParam;
  } else {
    // default: this month
    startDate = todayStr.slice(0, 7) + "-01";
  }

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("get_executive_metrics", {
      p_start_date: startDate,
      p_end_date: endDate,
    });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

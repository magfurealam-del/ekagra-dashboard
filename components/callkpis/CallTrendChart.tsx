"use client";
import { TrendChart } from "@/components/admin/DecisionCharts";
import { CALL_SERIES } from "@/lib/decision-dashboard";
export default function CallTrendChart({
  data,
}: {
  data: {
    date: string;
    incoming: number;
    outgoing_leads: number;
    outbound: number;
    confirmation?: number;
  }[];
}) {
  return (
    <TrendChart
      data={data.map((row) => ({
        ...row,
        confirmation: row.confirmation ?? 0,
      }))}
      series={CALL_SERIES}
    />
  );
}

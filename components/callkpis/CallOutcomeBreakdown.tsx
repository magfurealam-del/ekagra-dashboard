"use client";
import { useState } from "react";
import {
  ChartPanel,
  Filter,
  Note,
  RankedBars,
} from "@/components/admin/DecisionCharts";
import { CALL_SERIES, type CountRow } from "@/lib/decision-dashboard";
export function CallOutcomeBreakdown({
  incoming,
  outgoing,
  outbound,
  confirmation,
}: {
  incoming: CountRow[];
  outgoing: CountRow[];
  outbound: CountRow[];
  confirmation: CountRow[];
}) {
  const [purpose, setPurpose] = useState("incoming");
  const rows =
    purpose === "incoming"
      ? incoming
      : purpose === "outgoing_leads"
        ? outgoing
        : purpose === "outbound"
          ? outbound
          : confirmation;
  return (
    <ChartPanel
      title="Recorded call outcomes"
      subtitle={`${rows.reduce((n, r) => n + r.count, 0)} recorded outcomes in this period · one call purpose at a time`}
      action={
        <Filter
          label="Outcome call purpose"
          value={purpose}
          onChange={setPurpose}
          options={CALL_SERIES.map((s) => ({ value: s.key, label: s.label }))}
        />
      }
    >
      <RankedBars rows={rows} />
      <Note>
        Outcome categories depend on call purpose. Attempt counts are not unique
        people, and confirmation is not a new booking opportunity.
      </Note>
    </ChartPanel>
  );
}

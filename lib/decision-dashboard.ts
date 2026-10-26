import type { ExecutiveMetrics } from "./dashboard-presentation";

export type CountRow = { label: string; count: number };
export type CohortRow = {
  id?: string;
  name: string;
  contacts: number;
  immature: number;
  scheduled: number;
  verified: number;
};
export type Cohort = Omit<CohortRow, "id" | "name"> & {
  horizon: number;
  sources: CohortRow[];
  campaigns: CohortRow[];
};
export type DecisionInsights = {
  daily: {
    date: string;
    revenue: number;
    invoices: number;
    verified: number | null;
    eligible: number | null;
  }[];
  cohorts: Cohort[];
  delays: {
    name: string;
    contacts: number;
    scheduled: number;
    median_days: number | null;
    p75_days: number | null;
  }[];
  queue: { total: number; age: CountRow[]; categories: CountRow[] };
  attempt_outcomes: CountRow[];
  quality: { age: CountRow[]; reasons: CountRow[] };
  attribution: {
    known_source: number;
    unknown_source: number;
    review_reasons: CountRow[];
    fields: CountRow[];
  };
  ad_eligible: {
    campaign_id: string;
    ad_id: string | null;
    eligible: number;
    unresolved: number;
  }[];
};
export type Attendance = {
  eligible: number;
  verified: number;
  explicit_no_show: number;
  unresolved: number;
  excluded: number;
  awaiting_maturity: number;
  evidence_conflicts: number;
  eligible_through: string;
};
export type DecisionMetrics = ExecutiveMetrics & {
  attendance: Attendance;
  revenue_scope?: {
    acquisition_ledger_total: number;
    unattributed_acquisition: number;
  };
  by_location?: { area: string; count: number }[];
  by_service_type?: { type: string; count: number }[];
  by_doctor?: { doctor: string; count: number }[];
};
export type AgentRow = {
  agent: string;
  incoming: number;
  incoming_booked: number;
  outgoing_leads: number;
  outgoing_leads_booked: number;
  outbound: number;
  outbound_booked: number;
  outbound_reached: number;
  confirmation: number;
  confirmation_confirmed: number;
  revenue_new: number;
  revenue_followup: number;
  outbound_outcomes: { outcome: string; count: number }[];
};
export type SourceRow = {
  source: string;
  leads: number;
  new_leads: number;
  old_leads: number;
  appointments_eligible: number;
  new_attended: number;
  old_attended: number;
  no_shows: number;
};
export type AdRow = {
  campaign_id: string;
  ad_id: string | null;
  campaign_name: string | null;
  ad_name: string | null;
  leads: number;
  booked: number;
  appointments: number;
  completed: number;
  revenue: number;
};
export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0
    ? Math.round((numerator / denominator) * 1000) / 10
    : null;
}
export function rateText(numerator: number, denominator: number) {
  const value = rate(numerator, denominator);
  return value == null ? "—" : `${value}%`;
}
export function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
export const CALL_SERIES = [
  { key: "incoming", label: "Incoming", color: "#0f766e" },
  { key: "outgoing_leads", label: "Outgoing", color: "#6366f1" },
  { key: "outbound", label: "Outbound", color: "#b45309" },
  { key: "confirmation", label: "Confirmation", color: "#0284c7" },
];
export const OUTCOME_SERIES = [
  { key: "verified", label: "Verified", color: "#0f766e" },
  { key: "no_show", label: "Explicit no-show", color: "#64748b" },
  { key: "unresolved", label: "Unresolved", color: "#d97706" },
];
export function isHumanAgent(row: AgentRow) {
  return (
    row.agent !== "Unassigned" &&
    !/^(mis_|invoice_|system|unknown)/i.test(row.agent) &&
    row.incoming + row.outgoing_leads + row.outbound + row.confirmation > 0
  );
}
export function topRows(rows: CountRow[], limit = 7): CountRow[] {
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  return sorted.length > limit
    ? [
        ...sorted.slice(0, limit),
        {
          label: "Other categories",
          count: sorted.slice(limit).reduce((sum, r) => sum + r.count, 0),
        },
      ]
    : sorted;
}

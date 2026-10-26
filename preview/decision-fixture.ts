import { clinicDate, shiftDate } from "../lib/dashboard-presentation";
import type {
  AgentRow,
  DecisionInsights,
  SourceRow,
} from "../lib/decision-dashboard";
// Entirely synthetic. No production records or credentials belong in this fixture.
export const fixtureAgents: AgentRow[] = ["Agent A", "Agent B", "Agent C"].map(
  (agent, i) => ({
    agent,
    incoming: 80 + i * 15,
    incoming_booked: 35 + i * 8,
    outgoing_leads: 32 + i * 10,
    outgoing_leads_booked: 12 + i * 4,
    outbound: 60 + i * 8,
    outbound_booked: 10 + i * 3,
    outbound_reached: 26 + i * 6,
    confirmation: 28 + i * 5,
    confirmation_confirmed: 22 + i * 3,
    revenue_new: 80000 + i * 12000,
    revenue_followup: 42000,
    outbound_outcomes: [
      { outcome: "reached", count: 26 },
      { outcome: "not_reached", count: 34 },
    ],
  }),
);
export const fixtureSources: SourceRow[] = [
  "Hotline",
  "Facebook",
  "Referral",
  "Unknown",
].map((source, i) => ({
  source,
  leads: 300 - i * 60,
  new_leads: 200 - i * 40,
  old_leads: 80 - i * 15,
  appointments_eligible: 80 - i * 15,
  new_attended: 30 - i * 6,
  old_attended: 12 - i * 2,
  no_shows: 15 - i * 3,
}));
export const fixtureInsights: DecisionInsights = {
  daily: Array.from({ length: 26 }, (_, i) => ({
    date: shiftDate(clinicDate(), i - 25),
    revenue: 16000 + ((i * 3191) % 25000),
    invoices: 4 + (i % 7),
    verified: i > 23 ? null : 2 + (i % 7),
    eligible: i > 23 ? null : 8 + (i % 12),
  })),
  cohorts: [7, 14, 30].map((horizon) => ({
    horizon,
    contacts: 360,
    immature: 480,
    scheduled: 212,
    verified: 94,
    sources: [
      {
        name: "Hotline",
        contacts: 180,
        immature: 220,
        scheduled: 110,
        verified: 62,
      },
      {
        name: "Facebook",
        contacts: 120,
        immature: 180,
        scheduled: 75,
        verified: 24,
      },
      {
        name: "Referral",
        contacts: 60,
        immature: 80,
        scheduled: 27,
        verified: 8,
      },
    ],
    campaigns: [],
  })),
  delays: [
    {
      name: "Hotline",
      contacts: 300,
      scheduled: 210,
      median_days: 2,
      p75_days: 4,
    },
    {
      name: "Facebook",
      contacts: 240,
      scheduled: 120,
      median_days: 3,
      p75_days: 7,
    },
    {
      name: "Referral",
      contacts: 180,
      scheduled: 150,
      median_days: 1,
      p75_days: 2,
    },
  ],
  queue: {
    total: 216,
    age: [
      { label: "0–7 days", count: 42 },
      { label: "8–14 days", count: 68 },
      { label: "15–30 days", count: 74 },
      { label: "31+ days", count: 30 },
      { label: "Unknown date", count: 2 },
    ],
    categories: [
      { label: "missed_followup_7", count: 115 },
      { label: "website_appointment_made", count: 48 },
      { label: "general_no_appt", count: 53 },
    ],
  },
  attempt_outcomes: [
    { label: "reached", count: 64 },
    { label: "not_reached", count: 52 },
    { label: "booked_appointment", count: 31 },
    { label: "busy", count: 18 },
  ],
  quality: {
    age: [
      { label: "0–7 days", count: 12 },
      { label: "8–14 days", count: 9 },
      { label: "15–30 days", count: 10 },
      { label: "31+ days", count: 6 },
    ],
    reasons: [
      { label: "Completed without qualifying evidence", count: 24 },
      { label: "Outcome not finalized", count: 13 },
    ],
  },
  attribution: {
    known_source: 720,
    unknown_source: 120,
    review_reasons: [
      { label: "needs_review_identity", count: 14 },
      { label: "needs_review_date", count: 8 },
    ],
    fields: [
      { label: "Source recorded", count: 720 },
      { label: "Patient type recorded", count: 810 },
      { label: "Agent recorded", count: 796 },
    ],
  },
  ad_eligible: [],
};
export const emptyInsights: DecisionInsights = {
  daily: [],
  cohorts: [7, 14, 30].map((horizon) => ({
    horizon,
    contacts: 0,
    immature: 0,
    scheduled: 0,
    verified: 0,
    sources: [],
    campaigns: [],
  })),
  delays: [],
  queue: { total: 0, age: [], categories: [] },
  attempt_outcomes: [],
  quality: { age: [], reasons: [] },
  attribution: {
    known_source: 0,
    unknown_source: 0,
    review_reasons: [],
    fields: [],
  },
  ad_eligible: [],
};

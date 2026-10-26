import {
  fixtureAgents,
  fixtureSources,
  fixtureInsights,
  emptyInsights,
} from "./decision-fixture";
import {
  clinicDate,
  shiftDate,
  type ExecutiveMetrics,
} from "../lib/dashboard-presentation";
// Invented fixture only: never load a production session, credential, or patient record.
const sample: ExecutiveMetrics = {
  total_leads: 840,
  booked_leads: 546,
  total_appointments: 620,
  total_revenue: 684200,
  mis_verified_attended: 128,
  completed_appointments_without_mis_visit_proof: 37,
  explicit_crm_no_shows: 82,
  pending_callbacks: 216,
  daily_trend: Array.from({ length: 25 }, (_, i) => ({
    date: shiftDate(clinicDate(), i - 24),
    leads: 18 + ((i * 7) % 23),
    appointments: 12 + ((i * 11) % 19),
  })),
  by_intake_outcome: [
    { outcome: "Appointment booked", count: 546 },
    { outcome: "No appointment yet", count: 198 },
    { outcome: "General inquiry", count: 64 },
    { outcome: "Not interested", count: 32 },
  ],
  by_patient_type: [
    { type: "New", count: 600 },
    { type: "Old", count: 240 },
  ],
  revenue_by_source: [
    { source: "Hotline", revenue: 388200 },
    { source: "Referral", revenue: 146000 },
    { source: "Facebook", revenue: 88000 },
    { source: "Walk-in", revenue: 62000 },
  ],
};
export const supabase = {
  from: () => {
    const query = { select: () => query, gte: () => query, lt: () => query, eq: () => query, then: (resolve: (value: {data: never[]; error: null}) => unknown) => Promise.resolve(resolve({data: [], error: null})) };
    return query;
  },
  rpc: (_name: string, args: { p_compare?: boolean; p_start_date?: string; p_end_date?: string; p_patient_id?: number }) => {
    if (_name === 'get_call_center_kpis_fast') {
      const count = args.p_start_date === args.p_end_date ? 3 : 120;
      return new Promise(resolve => setTimeout(() => resolve({error: null, data: {
        incoming_total: count, outgoing_leads_total: 0, outbound_total: 0, confirmation_total: 0, outbound_pending: 0,
        daily_trend: [{date: args.p_end_date, incoming: count, outgoing_leads: 0, outbound: 0, confirmation: 0}],
        by_agent: [{agent: 'Synthetic Agent', incoming: count, incoming_booked: 0, outgoing_leads: 0, outbound: 0, confirmation: 0}],
        by_incoming_outcome: [{outcome: 'General Inquiry', count}], by_outgoing_outcome: [], by_outbound_outcome: [], by_confirmation_outcome: [],
        call_log: Array.from({length: count}, (_, i) => ({patient_id:i+1, patient_name:`Synthetic contact ${i+1}`, call_date:`${args.p_end_date}T09:00:00+06:00`, direction:'Incoming', agent:'Synthetic Agent', invoice_check_date:args.p_end_date, details:{}, outcome:'General Inquiry'})),
      }}), count === 3 ? 100 : 900));
    }
    if (_name === 'get_call_kpi_invoice_match') return Promise.resolve({data:{status:'matched',method:'synthetic',invoice_no:`TEST-${args.p_patient_id}`,invoice_date:clinicDate()},error:null});
    return {
    abortSignal: async (_signal: AbortSignal) => {
      const state = new URLSearchParams(window.location.search).get("state");
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (state === "error")
        return { data: null, error: { message: "Synthetic network failure" } };
      if (state === "missing") return { data: null, error: null };
      const metrics =
        state === "empty"
          ? {
              total_leads: 0,
              booked_leads: 0,
              total_revenue: 0,
              mis_verified_attended: 0,
              pending_callbacks: 0,
              explicit_crm_no_shows: 0,
              completed_appointments_without_mis_visit_proof: 0,
            }
          : sample;
      return {
        data: {
          contract_version: 3,
          insights: state === "empty" ? emptyInsights : state === 'immature' ? {...fixtureInsights, daily:[{date:clinicDate(),verified:null,eligible:null,revenue:0,invoices:0}]} : fixtureInsights,
          metrics: {
            ...metrics,
            attendance: {
              eligible: state === "empty" ? 0 : 247,
              verified: state === "empty" ? 0 : 128,
              explicit_no_show: state === "empty" ? 0 : 82,
              unresolved: state === "empty" ? 0 : 37,
              excluded: state === "empty" ? 0 : 20,
              awaiting_maturity: state === "empty" ? 0 : 353,
              evidence_conflicts: 0,
              eligible_through: shiftDate(clinicDate(), -2),
            },
            show_rate: 51.8,
          },
          previous:
            args.p_compare && state !== "no-comparison"
              ? {
                  ...metrics,
                  total_revenue: 598000,
                  total_leads: 780,
                  booked_leads: 468,
                  mis_verified_attended: 112,
                }
              : null,
          refreshed_at: new Date(
            Date.now() - (state === "stale" ? 48 : 0) * 3600000,
          ).toISOString(),
          sources: { sources: state === "empty" ? [] : fixtureSources },
          agents: { agents: state === "empty" ? [] : fixtureAgents },
          ads: [],
          reconciliation: {
            pending: state === "pending",
            published_at: new Date().toISOString(),
          },
        },
        error: null,
      };
    },
    };
  },
};

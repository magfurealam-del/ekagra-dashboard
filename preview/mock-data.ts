import {
  clinicDate,
  shiftDate,
  type ExecutiveMetrics,
} from '../lib/dashboard-presentation'
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
    { outcome: 'Appointment booked', count: 546 },
    { outcome: 'No appointment yet', count: 198 },
    { outcome: 'General inquiry', count: 64 },
    { outcome: 'Not interested', count: 32 },
  ],
  by_patient_type: [
    { type: 'New', count: 600 },
    { type: 'Old', count: 240 },
  ],
  revenue_by_source: [
    { source: 'Hotline', revenue: 388200 },
    { source: 'Referral', revenue: 146000 },
    { source: 'Facebook', revenue: 88000 },
    { source: 'Walk-in', revenue: 62000 },
  ],
}
export const supabase = {
  rpc: (_name: string, args: { p_compare?: boolean }) => ({
    abortSignal: async (_signal: AbortSignal) => {
      const state = new URLSearchParams(window.location.search).get('state')
      await new Promise((resolve) => setTimeout(resolve, 200))
      if (state === 'error')
        return { data: null, error: { message: 'Synthetic network failure' } }
      if (state === 'missing') return { data: null, error: null }
      const metrics =
        state === 'empty'
          ? {
              total_leads: 0,
              booked_leads: 0,
              total_revenue: 0,
              mis_verified_attended: 0,
              pending_callbacks: 0,
              explicit_crm_no_shows: 0,
              completed_appointments_without_mis_visit_proof: 0,
            }
          : sample
      return {
        data: {
          contract_version: 2,
          metrics: {
            ...metrics,
            attendance: {
              eligible: 247,
              verified: 128,
              explicit_no_show: 82,
              unresolved: 37,
              excluded: 20,
              awaiting_maturity: 353,
              evidence_conflicts: 0,
              eligible_through: shiftDate(clinicDate(), -2),
            },
            show_rate: 51.8,
          },
          previous:
            args.p_compare && state !== 'no-comparison'
              ? {
                  ...metrics,
                  total_revenue: 598000,
                  total_leads: 780,
                  booked_leads: 468,
                  mis_verified_attended: 112,
                }
              : null,
          refreshed_at: new Date(
            Date.now() - (state === 'stale' ? 48 : 0) * 3600000,
          ).toISOString(),
          sources: { sources: [] },
          agents: { agents: [] },
          ads: [],
          reconciliation: {
            pending: state === 'pending',
            published_at: new Date().toISOString(),
          },
        },
        error: null,
      }
    },
  }),
}

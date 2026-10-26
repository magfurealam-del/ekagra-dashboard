export type RangeKey = 'today' | '7d' | '30d' | 'month' | 'custom'
export type DashboardTab =
  | 'overview'
  | 'agents'
  | 'channels'
  | 'funnel'
  | 'revenue'
  | 'sources'
  | 'quality'
  | 'ad_attribution'
export const DASHBOARD_TABS: { key: DashboardTab; label: string }[] = [
  { key: 'overview', label: 'Executive overview' },
  { key: 'agents', label: 'Team performance' },
  { key: 'channels', label: 'Acquisition' },
  { key: 'funnel', label: 'Follow-ups' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'sources', label: 'Attribution' },
  { key: 'quality', label: 'Data quality' },
  { key: 'ad_attribution', label: 'Ad performance' },
]
export interface ExecutiveMetrics {
  total_leads?: number
  booked_leads?: number
  total_appointments?: number
  total_revenue?: number
  attended?: number
  no_shows?: number
  show_rate?: number | null
  mis_verified_attended?: number | null
  completed_appointments_without_mis_visit_proof?: number | null
  explicit_crm_no_shows?: number | null
  pending_callbacks?: number
  daily_trend?: { date: string; leads: number; appointments: number }[]
  by_intake_outcome?: { outcome: string; count: number }[]
  by_patient_type?: { type: string; count: number }[]
  revenue_by_source?: { source: string; revenue: number }[]
  validation?: {
    invoice_matches_needing_review?: number
    attributed_invoice_count?: number
  }
}
export function clinicDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
export function rangeFor(
  key: RangeKey,
  customStart: string,
  customEnd: string,
  now = new Date(),
) {
  const end = clinicDate(now)
  if (key === 'custom') return { start: customStart, end: customEnd }
  return {
    start:
      key === 'month'
        ? `${end.slice(0, 7)}-01`
        : shiftDate(end, key === '7d' ? -6 : key === '30d' ? -29 : 0),
    end,
  }
}
export function previousRangeFor(start: string, end: string) {
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1
  return { start: shiftDate(start, -days), end: shiftDate(start, -1) }
}
export function validRange(start: string, end: string) {
  const validDate = (date: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
  return (
    validDate(start) &&
    validDate(end) &&
    end >= start &&
    Date.parse(end) - Date.parse(start) <= 365 * 86400000
  )
}
export function percentage(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
) {
  return numerator != null && denominator != null && denominator > 0
    ? Math.round((1000 * numerator) / denominator) / 10
    : null
}
export function change(current?: number | null, previous?: number | null) {
  if (current == null || previous == null || previous === 0) return null
  return Math.round((1000 * (current - previous)) / previous) / 10
}
export function formatNumber(value?: number | null) {
  return value == null ? '—' : value.toLocaleString('en-GB')
}
export function formatMoney(value?: number | null) {
  return value == null ? '—' : `৳${Math.round(value).toLocaleString('en-GB')}`
}
export function displayDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
export function snapshotAge(refreshedAt: string | null, now = Date.now()) {
  if (!refreshedAt || !Number.isFinite(Date.parse(refreshedAt)))
    return 'unknown'
  return now - Date.parse(refreshedAt) > 26 * 60 * 60 * 1000
    ? 'stale'
    : 'current'
}

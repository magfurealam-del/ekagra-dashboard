// Background refresh is intentionally slow to avoid multiplying Supabase
// requests across many open agent tabs. User actions still reload immediately.
export const CRM_POLL_INTERVAL_MS = 30 * 60 * 1000

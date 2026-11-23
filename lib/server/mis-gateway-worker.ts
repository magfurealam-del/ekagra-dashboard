import 'server-only'
import { getAdminSupabase } from './mis-upload-admin'
import { drainMisQueue } from '../mis-upload/worker'

export function ingestionEnabled() {
  return process.env.MIS_INGESTION_ENABLED === 'true'
}

// Fire-and-forget: starts the self-chaining drain endpoint which keeps
// processing gateway jobs in successive serverless invocations until done.
export function kickDrain() {
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'
  fetch(`${base}/api/internal/mis-drain`, {
    method: 'POST',
    headers: { 'x-mis-drain-token': process.env.MIS_DRAIN_TOKEN ?? '' },
  }).catch(() => {})
}

export async function runMisGateway(options: { syncMarketingSpend?: boolean } = {}) {
  const admin = getAdminSupabase()
  const started = Date.now()
  let marketingSpend: unknown = { status: 'not_requested' }
  if (options.syncMarketingSpend !== false) try {
    const spend = await admin.functions.invoke('marketing-spend-sync', { body: {}, timeout: 85000 })
    if (spend.error) console.error('Marketing spend sync unavailable; MIS reconciliation continues and source freshness remains visible')
    else marketingSpend = spend.data
  } catch {
    console.error('Marketing spend sync interrupted; MIS reconciliation continues')
  }
  const result = await drainMisQueue(async () => {
    const { data, error } = await admin.rpc('mis_gateway_tick')
    if (error) throw new Error('MIS worker RPC failed')
    if (!data || typeof data.status !== 'string') throw new Error('MIS worker returned no status')
    return data
  }, { budgetMs: Math.max(0, 240000 - (Date.now() - started)) })
  return { ...result, marketingSpend }
}

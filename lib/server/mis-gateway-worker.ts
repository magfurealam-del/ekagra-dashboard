import 'server-only'
import { getAdminSupabase } from './mis-upload-admin'
import { drainMisQueue } from '../mis-upload/worker'

export function ingestionEnabled() {
  return process.env.MIS_INGESTION_ENABLED === 'true'
}

// Calls the drain endpoint and awaits its response so the caller's runtime
// (typically an after() callback) stays alive until the first batch completes.
// The drain endpoint self-chains for any remaining batches independently.
export async function kickDrain(forceDaytime = false) {
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'
  await fetch(`${base}/api/internal/mis-drain`, {
    method: 'POST',
    headers: {
      'x-mis-drain-token': process.env.MIS_DRAIN_TOKEN ?? '',
      ...(forceDaytime ? { 'x-mis-force-daytime': 'true' } : {}),
    },
  }).catch(() => {})
}

export async function runMisGateway(forceDaytime = false) {
  const admin = getAdminSupabase()
  const started = Date.now()
  const result = await drainMisQueue(async () => {
    const { data, error } = await admin.rpc('mis_gateway_tick', { p_force_daytime: forceDaytime })
    if (error) throw new Error('MIS worker RPC failed')
    if (!data || typeof data.status !== 'string') throw new Error('MIS worker returned no status')
    return data
  }, { budgetMs: Math.max(0, 240000 - (Date.now() - started)) })
  return result
}

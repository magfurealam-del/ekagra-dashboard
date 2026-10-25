import 'server-only'
import { getAdminSupabase } from './mis-upload-admin'
import { drainMisQueue } from '../mis-upload/worker'

export function ingestionEnabled() {
  return process.env.MIS_INGESTION_ENABLED === 'true'
}

export async function runMisGateway() {
  const admin = getAdminSupabase()
  const started = Date.now()
  let marketingSpend: unknown = { status: 'unavailable' }
  try {
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

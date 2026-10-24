import 'server-only'
import { getAdminSupabase } from './mis-upload-admin'
import { drainMisQueue } from '../mis-upload/worker'

export function ingestionEnabled() {
  return process.env.MIS_INGESTION_ENABLED === 'true'
}

export async function runMisGateway() {
  const admin = getAdminSupabase()
  return drainMisQueue(async () => {
    const { data, error } = await admin.rpc('mis_gateway_tick')
    if (error) throw new Error('MIS worker RPC failed')
    if (!data || typeof data.status !== 'string') throw new Error('MIS worker returned no status')
    return data
  })
}

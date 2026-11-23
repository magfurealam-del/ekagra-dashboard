import { NextResponse } from 'next/server'
import { ingestionEnabled } from '@/lib/server/mis-gateway-worker'
import { getAdminSupabase } from '@/lib/server/mis-upload-admin'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const token = request.headers.get('x-mis-drain-token')
  if (!token || token !== process.env.MIS_DRAIN_TOKEN || !ingestionEnabled()) {
    return NextResponse.json({ status: 'skip' })
  }

  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('crm_reconcile_all')
  if (error) {
    console.error('[crm-reconcile] RPC failed', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  console.log('[crm-reconcile]', data)
  return NextResponse.json(data)
}

import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/server/supabase-admin'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST() {
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('crm_reconcile_all')
  if (error) {
    console.error('[crm-reconcile] RPC failed', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  console.log('[crm-reconcile]', data)
  return NextResponse.json(data)
}

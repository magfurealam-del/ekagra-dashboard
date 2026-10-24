import { NextRequest, NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/server/mis-upload-admin'

// Uses the protected server RPC and exact patient/date/doctor clinical
// evidence. Missing billing must never infer a No-show.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { data, error } = await getAdminSupabase().rpc('cron_sync_appointment_status_from_invoices')
    if (error) throw error
    console.log('[cron/sync-invoice-corrections]', { rows_updated: data })
    return NextResponse.json({ success: true, rows_updated: data })
  } catch {
    return NextResponse.json({ error: 'Invoice reconciliation is temporarily unavailable.' }, { status: 503 })
  }
}

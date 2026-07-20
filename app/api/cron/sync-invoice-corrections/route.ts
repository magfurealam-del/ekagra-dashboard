import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Nightly: reconciles appointment status, patient name, phone, and hospital
// ID against matched invoices for a rolling 45-day window (not full
// history — that's a deliberate one-off admin action, not an automated
// one; see the "Recompute entire history" button in the admin dashboard).
// Invoice data always wins over manual entries here; Cancelled and
// Rescheduled appointments are left untouched. Calls a fixed-window RPC
// (not the admin-gated one) since this route runs unauthenticated.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { data, error } = await supabase.rpc('cron_sync_appointment_status_from_invoices')
    if (error) throw error
    console.log('[cron/sync-invoice-corrections]', { rows_updated: data })
    return NextResponse.json({ success: true, rows_updated: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

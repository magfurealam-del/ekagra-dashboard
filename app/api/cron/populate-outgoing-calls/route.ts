import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  // If CRON_SECRET isn't configured yet, allow the call through (matches other
  // cron routes in this repo's fallback pattern) rather than locking everyone out.
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { data, error } = await supabase.rpc('populate_outgoing_call_queue')
    if (error) throw error
    console.log('[cron/populate-outgoing-calls]', data)
    return NextResponse.json({ success: true, result: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

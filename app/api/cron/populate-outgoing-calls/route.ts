import { NextRequest, NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/server/mis-upload-admin'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { data, error } = await getAdminSupabase().rpc('populate_outgoing_call_queue')
    if (error) throw error
    console.log('[cron/populate-outgoing-calls]', data)
    return NextResponse.json({ success: true, result: data })
  } catch {
    return NextResponse.json({ error: 'Outbound queue refresh is temporarily unavailable.' }, { status: 503 })
  }
}

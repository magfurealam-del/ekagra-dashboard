import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { rangeFor } from '@/lib/dashboard-presentation'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Missing server Supabase configuration' }, { status: 500 })
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const now = new Date()
  const ranges = (['today', '7d', '30d', 'month'] as const).map(key => rangeFor(key, '', '', now))
  const results = []
  for (const r of ranges) {
    const { data, error } = await admin.rpc('refresh_dashboard_metric_snapshot_cron', {
      p_start_date: r.start, p_end_date: r.end,
    })
    if (error) return NextResponse.json({ error: error.message, range: r }, { status: 500 })
    results.push(data)
  }
  return NextResponse.json({ success: true, refreshed: results.length, results })
}

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { ingestionEnabled, runMisGateway } from '@/lib/server/mis-gateway-worker'
import { isOvernightInDhaka } from '@/lib/mis-upload/worker'

export const runtime = 'nodejs'
export const maxDuration = 300
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const supplied = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret ?? ''}`)
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!ingestionEnabled()) return NextResponse.json({ status: 'disabled' })
  try {
    const result = await runMisGateway({ syncMarketingSpend: isOvernightInDhaka() })
    return NextResponse.json(result, { status: result.last.code ? 503 : 200, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'MIS worker unavailable; queued jobs are retained.' }, { status: 503 })
  }
}

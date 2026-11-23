import { NextResponse } from 'next/server'
import { ingestionEnabled, runMisGateway } from '@/lib/server/mis-gateway-worker'

export const runtime = 'nodejs'
export const maxDuration = 300

const ADVANCING = new Set(['completed', 'superseded', 'advanced'])

function deploymentBase() {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

export async function POST(request: Request) {
  const token = request.headers.get('x-mis-drain-token')
  if (!token || token !== process.env.MIS_DRAIN_TOKEN || !ingestionEnabled()) {
    return NextResponse.json({ status: 'skip' })
  }

  const result = await runMisGateway()

  // If the last tick was still advancing when the budget ran out, chain another invocation.
  if (ADVANCING.has(result.last?.status ?? '')) {
    fetch(`${deploymentBase()}/api/internal/mis-drain`, {
      method: 'POST',
      headers: { 'x-mis-drain-token': process.env.MIS_DRAIN_TOKEN ?? '' },
    }).catch(() => {})
  }

  return NextResponse.json({ ticks: result.ticks, elapsedMs: result.elapsedMs, last: result.last })
}

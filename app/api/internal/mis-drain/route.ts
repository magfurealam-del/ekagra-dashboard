import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { ingestionEnabled, runMisGateway } from '@/lib/server/mis-gateway-worker'

export const runtime = 'nodejs'
export const maxDuration = 300

// A retry has been recorded with a future next_attempt_at. Chain the drain so
// that this one deferred invoice does not leave the rest of the batch queued.
const ADVANCING = new Set(['completed', 'superseded', 'advanced', 'retry'])

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

  // If budget ran out with work remaining, chain the next invocation.
  // waitUntil keeps the runtime alive until the fetch resolves so the
  // request actually goes out before this function is frozen.
  if (ADVANCING.has(result.last?.status ?? '')) {
    waitUntil(
      fetch(`${deploymentBase()}/api/internal/mis-drain`, {
        method: 'POST',
        headers: { 'x-mis-drain-token': process.env.MIS_DRAIN_TOKEN ?? '' },
      }).catch(() => {})
    )
  }

  return NextResponse.json({ ticks: result.ticks, elapsedMs: result.elapsedMs, last: result.last })
}

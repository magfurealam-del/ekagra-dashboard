import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
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

  // Self-chain continuations set x-mis-drain-chain so we skip the 85 s
  // marketing-spend sync and use the full budget for invoice processing.
  const isChain = request.headers.get('x-mis-drain-chain') === '1'
  const result = await runMisGateway({ syncMarketingSpend: !isChain })

  // If budget ran out with work remaining, chain the next invocation.
  // waitUntil keeps the runtime alive until the fetch resolves so the
  // request actually goes out before this function is frozen.
  if (ADVANCING.has(result.last?.status ?? '')) {
    waitUntil(
      fetch(`${deploymentBase()}/api/internal/mis-drain`, {
        method: 'POST',
        headers: {
          'x-mis-drain-token': process.env.MIS_DRAIN_TOKEN ?? '',
          'x-mis-drain-chain': '1',
        },
      }).catch(() => {})
    )
  }

  return NextResponse.json({ ticks: result.ticks, elapsedMs: result.elapsedMs, last: result.last })
}

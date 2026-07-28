import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'

const VERIFY_TOKEN      = process.env.META_WEBHOOK_VERIFY_TOKEN
const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// GET — Meta calls this once when you register the webhook.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// POST — Meta sends this for every inbound message on your Page.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  // Return 200 immediately — Meta retries if you don't respond fast enough.
  // `after` keeps the serverless function alive until the insert completes.
  after(() => insert(body).catch((err) => console.error('[meta-webhook] insert error', err)))
  return new NextResponse('EVENT_RECEIVED', { status: 200 })
}

async function insert(body: Record<string, unknown>) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const entries = body.entry as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(entries)) return

  const rows: Record<string, unknown>[] = []

  for (const entry of entries) {
    const pageId    = String(entry.id ?? '')
    const messaging = entry.messaging as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(messaging)) continue

    for (const event of messaging) {
      const sender   = event.sender  as { id?: string } | undefined
      const message  = event.message as { text?: string; referral?: unknown } | undefined
      const referral = (event.referral ?? message?.referral) as Record<string, unknown> | undefined

      const psid        = sender?.id ?? ''
      const messageText = message?.text ?? null

      // Ad referral — present on the first message from a Click-to-Messenger ad
      const adId           = String(referral?.ad_id       ?? '') || null
      const campaignId     = String(referral?.campaign_id ?? '') || null
      const adsetId        = String(referral?.adset_id    ?? '') || null
      const referralSource = String(referral?.source      ?? '') || null
      const referralType   = String(referral?.type        ?? '') || null

      if (!psid) continue

      rows.push({
        psid,
        page_id:         pageId,
        message_text:    messageText,
        ad_id:           adId,
        campaign_id:     campaignId,
        adset_id:        adsetId,
        referral_source: referralSource,
        referral_type:   referralType,
        raw_payload:     event,
      })
    }
  }

  if (rows.length === 0) return
  const { error } = await supabase.from('messenger_events').insert(rows)
  if (error) console.error('[meta-webhook] supabase insert failed', error)
}

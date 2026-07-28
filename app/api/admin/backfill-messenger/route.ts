import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const GRAPH = 'https://graph.facebook.com/v20.0'

// POST /api/admin/backfill-messenger
// Authorization: Bearer <CRON_SECRET>
// Body: { page_id, access_token, cursor? }
//
// Processes one page of conversations (25) at a time.
// Returns next_cursor so you can paginate: call again with cursor=<next_cursor>
// until has_more is false.
//
// Note: ad referral data (campaign_id, ad_id) is NOT available for historical
// messages — only phone-number-based lead matching will work on backfilled rows.

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { page_id?: string; access_token?: string; cursor?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { page_id, access_token, cursor } = body
  if (!page_id || !access_token) {
    return NextResponse.json({ error: 'page_id and access_token are required' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  // 1. Fetch one page of conversations
  const convUrl = new URL(`${GRAPH}/${page_id}/conversations`)
  convUrl.searchParams.set('fields', 'id,participants,updated_time')
  convUrl.searchParams.set('limit', '25')
  convUrl.searchParams.set('access_token', access_token)
  if (cursor) convUrl.searchParams.set('after', cursor)

  const convRes  = await fetch(convUrl.toString())
  const convData = await convRes.json()

  if (convData.error) {
    return NextResponse.json({ error: convData.error }, { status: 400 })
  }

  const conversations: any[] = convData.data ?? []
  let inserted = 0
  let skipped  = 0

  // 2. For each conversation fetch its messages (up to 100 most recent)
  for (const conv of conversations) {
    const msgUrl = new URL(`${GRAPH}/${conv.id}/messages`)
    msgUrl.searchParams.set('fields', 'id,message,from,created_time')
    msgUrl.searchParams.set('limit', '100')
    msgUrl.searchParams.set('access_token', access_token)

    const msgRes  = await fetch(msgUrl.toString())
    const msgData = await msgRes.json()

    if (msgData.error || !Array.isArray(msgData.data)) continue

    const rows: Record<string, unknown>[] = []

    for (const msg of msgData.data) {
      // Skip messages sent BY the page, and messages with no text
      if (!msg.message || msg.from?.id === page_id) continue

      rows.push({
        meta_message_id: msg.id,
        psid:            msg.from?.id ?? '',
        page_id,
        message_text:    msg.message,
        ad_id:           null,
        campaign_id:     null,
        adset_id:        null,
        referral_source: 'BACKFILL',
        referral_type:   null,
        raw_payload:     msg,
        received_at:     msg.created_time,
        processed:       false,
      })
    }

    if (rows.length === 0) continue

    // upsert — skip rows whose meta_message_id already exists
    const { error, count } = await supabase
      .from('messenger_events')
      .upsert(rows, { onConflict: 'meta_message_id', ignoreDuplicates: true, count: 'exact' })

    if (error) {
      console.error('[backfill-messenger] upsert error', error)
    } else {
      inserted += count ?? rows.length
      skipped  += rows.length - (count ?? rows.length)
    }
  }

  const nextCursor = convData.paging?.cursors?.after ?? null
  const hasMore    = !!convData.paging?.next

  return NextResponse.json({
    conversations_processed: conversations.length,
    inserted,
    skipped,
    has_more:    hasMore,
    next_cursor: nextCursor,
  })
}

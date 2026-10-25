import { after, NextResponse } from 'next/server'
import { requireActiveAdmin } from '@/lib/server/mis-upload-admin'
import { ingestionEnabled, runMisGateway } from '@/lib/server/mis-gateway-worker'
import { positiveId, UUID, validateCorrection } from '@/lib/marketing-review/validation'

export const runtime = 'nodejs'
export const maxDuration = 300
const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Authorization' }
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers })

export async function GET(request: Request) {
  const auth = await requireActiveAdmin(request)
  if ('response' in auth) return auth.response
  const q = new URL(request.url).searchParams
  const kind = q.get('kind') || 'meta'
  const page = Number(q.get('page') || '0')
  const id = q.has('id') ? positiveId(q.get('id')) : null
  if (!['meta','revenue','leads'].includes(kind) || !Number.isSafeInteger(page) || page < 0 || page > 10000
    || (q.has('id') && id === null) || (q.get('search') || '').length > 100 || (q.get('filter') || '').length > 100) return fail('Invalid review query.', 400)
  const { data, error } = await auth.admin.rpc('marketing_review_read', {
    p_actor_id: auth.actorId, p_kind: kind, p_id: id, p_page: page,
    p_filter: q.get('filter') || '', p_search: q.get('search') || '',
  })
  if (error) return fail(error.code === 'P0002' ? 'Review case not found.' : 'Unable to load the review workspace.', error.code === 'P0002' ? 404 : 503)
  return NextResponse.json(kind === 'leads' ? data : { ...data, writesEnabled: ingestionEnabled() }, { headers })
}

export async function POST(request: Request) {
  const auth = await requireActiveAdmin(request)
  if ('response' in auth) return auth.response
  if (!ingestionEnabled()) return fail('Review corrections are temporarily paused.', 503)
  // Read a bounded stream, including clients that omit Content-Length.
  const reader = request.body?.getReader()
  if (!reader) return fail('A correction is required.', 400)
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > 16000) { await reader.cancel(); return fail('Correction is too large.', 413) }
      chunks.push(value)
    }
  } catch { return fail('Unable to read the correction.', 400) }
  let body
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return fail('Invalid JSON correction.', 400) }
  if (!body || !['meta','revenue'].includes(body.kind) || !positiveId(body.id)
    || typeof body.requestId !== 'string' || !UUID.test(body.requestId) || typeof body.version !== 'string' || !/^[a-f0-9]{32}$/.test(body.version)) return fail('Invalid correction request.', 400)
  const invalid = validateCorrection(body.kind, body.payload)
  if (invalid) return fail(invalid, 400)
  const { data, error } = await auth.admin.rpc('marketing_review_resolve', {
    p_actor_id: auth.actorId, p_request_id: body.requestId, p_kind: body.kind,
    p_id: body.id, p_version: body.version, p_payload: body.payload,
  })
  if (error) {
    if (['40001','23505'].includes(error.code)) return fail('This case or request changed. Reload the evidence before saving again.', 409)
    if (['22023','P0002'].includes(error.code)) return fail(error.message, 400)
    return fail('The correction could not be saved. Retry with the same request; no partial correction is committed.', 503)
  }
  after(async () => {
    try { await runMisGateway({ syncMarketingSpend: false }) } catch { console.error('Review correction saved; scheduled reconciliation will retry the durable source revision.') }
  })
  return NextResponse.json(data, { status: 202, headers })
}

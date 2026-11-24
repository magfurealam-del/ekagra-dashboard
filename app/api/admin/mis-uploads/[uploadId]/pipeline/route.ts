import { after, NextResponse } from 'next/server'
import { jsonError, requireActiveAdmin, uploadsEnabled } from '@/lib/server/mis-upload-admin'
import { ingestionEnabled, kickDrain } from '@/lib/server/mis-gateway-worker'

export const runtime = 'nodejs'
export const maxDuration = 300
type Context = { params: Promise<{ uploadId: string }> }
async function accessUpload(request: Request, context: Context) {
  const access = await requireActiveAdmin(request)
  if ('response' in access) return access
  const { uploadId } = await context.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
    return { response: jsonError('Upload not found.', 404) }
  }
  return { ...access, uploadId }
}
export async function GET(request: Request, context: Context) {
  if (!uploadsEnabled()) return jsonError('MIS uploads are disabled.', 404)
  const access = await accessUpload(request, context)
  if ('response' in access) return access.response
  const { data, error } = await access.admin.rpc('mis_gateway_status', { p_actor_id: access.actorId, p_upload_id: access.uploadId })
  if (error) return jsonError('Pipeline status unavailable.', 503)
  return NextResponse.json({ pipeline: data, ingestionEnabled: ingestionEnabled() }, { headers: { 'Cache-Control': 'no-store' } })
}
export async function POST(request: Request, context: Context) {
  if (!uploadsEnabled() || !ingestionEnabled()) return jsonError('Canonical ingestion is not enabled.', 409)
  const access = await accessUpload(request, context)
  if ('response' in access) return access.response
  let action: unknown
  try { ({ action } = await request.json()) } catch { return jsonError('Invalid action.') }
  if (action !== 'enqueue' && action !== 'retry' && action !== 'refresh' && action !== 'force-sync') return jsonError('Invalid action.')
  if (action === 'force-sync') {
    const { data: pipeline, error: statusError } = await access.admin.rpc('mis_gateway_status', {
      p_actor_id: access.actorId, p_upload_id: access.uploadId,
    })
    if (statusError) return jsonError('The queue status could not be checked.', 503)
    if (!pipeline || (pipeline.pending === 0 && pipeline.failed === 0 && pipeline.published)) {
      return jsonError('There is no pending MIS work to force-sync.', 409)
    }
    // This action only wakes the existing idempotent worker. It does not reset
    // attempts, rewrite source rows, or bypass per-invoice retry safeguards.
    after(async () => { await kickDrain() })
    return NextResponse.json({ accepted: true, message: 'Force sync requested.' }, { status: 202 })
  }
  if (action === 'retry') {
    // Keep every retry update bounded. A request can requeue at most 2,500 jobs
    // in 25 sequential chunks; larger queues can be resumed with another call.
    let requeued = 0
    let reachedLimit = false
    for (let chunk = 0; chunk < 25; chunk += 1) {
      const { data, error } = await access.admin.rpc('retry_mis_gateway_chunk', {
        p_actor_id: access.actorId,
        p_upload_id: access.uploadId,
        p_chunk_size: 100,
      })
      if (error) return jsonError('The retry batch could not be recorded.', 503)
      const count = Number(data?.requeued ?? 0)
      requeued += count
      if (count < 100) break
      reachedLimit = chunk === 24
    }
    let more = false
    if (reachedLimit) {
      const { data: pipeline, error } = await access.admin.rpc('mis_gateway_status', {
        p_actor_id: access.actorId,
        p_upload_id: access.uploadId,
      })
      if (error) return jsonError('The remaining retry queue could not be checked.', 503)
      more = Number(pipeline?.failed ?? 0) > 0
    }
    after(async () => { await kickDrain() })
    return NextResponse.json({ requeued, more, chunkSize: 100 }, { status: 202 })
  }
  const rpc = action === 'enqueue' ? 'enqueue_mis_upload' : 'request_marketing_reconciliation'
  const { data, error } = await access.admin.rpc(rpc, {
    p_actor_id: access.actorId, p_upload_id: access.uploadId,
  })
  if (error) return jsonError(error.code === '22023' ? 'Invoice validation failed. Check that each invoice has consistent header fields and at most 1,000 lines.' : 'The pipeline action could not be recorded.', error.code === '22023' ? 422 : 503)
  after(async () => { await kickDrain() })
  return NextResponse.json(data, { status: 202 })
}

import { after, NextResponse } from 'next/server'
import { jsonError, requireActiveAdmin, uploadsEnabled } from '@/lib/server/mis-upload-admin'
import { ingestionEnabled, runMisGateway } from '@/lib/server/mis-gateway-worker'

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
  if (action !== 'enqueue' && action !== 'retry') return jsonError('Invalid action.')
  const { data, error } = await access.admin.rpc(action === 'enqueue' ? 'enqueue_mis_upload' : 'retry_mis_gateway', {
    p_actor_id: access.actorId, p_upload_id: access.uploadId,
  })
  if (error) return jsonError(error.code === '22023' ? 'Invoice validation failed. Check that each invoice has consistent header fields and at most 1,000 lines.' : 'The pipeline action could not be recorded.', error.code === '22023' ? 422 : 503)
  after(async () => { try { await runMisGateway() } catch { console.error('MIS worker deferred; durable queue retained') } })
  return NextResponse.json(data, { status: 202 })
}

import { NextResponse } from 'next/server'
import { jsonError, requireActiveAdmin, uploadsEnabled } from '@/lib/server/mis-upload-admin'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ uploadId: string }> }

export async function GET(request: Request, context: RouteContext) {
  if (!uploadsEnabled()) return jsonError('MIS upload intake is not enabled.', 404)
  const access = await requireActiveAdmin(request)
  if ('response' in access) return access.response

  const { uploadId } = await context.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
    return jsonError('Upload receipt was not found.', 404)
  }

  const { data, error } = await access.admin.rpc('get_mis_upload_review', {
    p_actor_id: access.actorId,
    p_upload_id: uploadId,
  })
  if (error) return jsonError('Upload review details are temporarily unavailable.', 503)
  if (!data) return jsonError('Upload receipt was not found.', 404)
  return NextResponse.json({ review: data }, { headers: { 'Cache-Control': 'no-store' } })
}

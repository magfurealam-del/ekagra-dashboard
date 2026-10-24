import { NextResponse } from 'next/server'
import { jsonError, requireActiveAdmin, uploadsEnabled } from '@/lib/server/mis-upload-admin'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ uploadId: string }> }

export async function POST(request: Request, context: RouteContext) {
  if (!uploadsEnabled()) return jsonError('MIS upload intake is not enabled.', 404)
  const access = await requireActiveAdmin(request)
  if ('response' in access) return access.response

  const { uploadId } = await context.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
    return jsonError('Upload receipt was not found.', 404)
  }

  const { data, error } = await access.admin.rpc('preview_mis_upload_candidates', {
    p_actor_id: access.actorId,
    p_upload_id: uploadId,
  })
  if (error) {
    const invalid = error.code === '22023'
    const missing = error.code === 'P0002'
    return jsonError(
      invalid ? 'Resolve validation findings before comparing this upload.' :
        missing ? 'A sealed parse was not found for this receipt.' :
          'Candidate comparison is temporarily unavailable.',
      invalid ? 422 : missing ? 404 : 503,
    )
  }
  return NextResponse.json({ preview: data }, { headers: { 'Cache-Control': 'no-store' } })
}

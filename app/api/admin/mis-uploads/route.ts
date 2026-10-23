import { NextResponse } from 'next/server'
import { BUCKET, jsonError, requireActiveAdmin, uploadsEnabled } from '@/lib/server/mis-upload-admin'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  if (!uploadsEnabled()) return jsonError('MIS upload intake is not enabled.', 404)
  const access = await requireActiveAdmin(request)
  if ('response' in access) return access.response

  const { data, error } = await access.admin.rpc('list_mis_uploads', {
    p_actor_id: access.actorId,
    p_limit: 50,
  })
  if (error) return jsonError('Upload history is temporarily unavailable.', 503)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(request: Request) {
  if (!uploadsEnabled()) return jsonError('MIS upload intake is not enabled.', 404)
  const access = await requireActiveAdmin(request)
  if ('response' in access) return access.response

  let body: { fileName?: unknown; byteCount?: unknown; mediaType?: unknown; requestIdempotencyKey?: unknown }
  try { body = await request.json() } catch { return jsonError('Request body must be valid JSON.') }
  if (
    typeof body.fileName !== 'string' ||
    typeof body.byteCount !== 'number' ||
    typeof body.mediaType !== 'string' ||
    typeof body.requestIdempotencyKey !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestIdempotencyKey)
  ) return jsonError('Upload metadata is invalid.')

  const { data: reservation, error: reserveError } = await access.admin.rpc('reserve_mis_upload', {
    p_actor_id: access.actorId,
    p_request_idempotency_key: body.requestIdempotencyKey,
    p_file_name: body.fileName,
    p_byte_count: body.byteCount,
    p_declared_media_type: body.mediaType,
  })
  if (reserveError) {
    const limited = reserveError.message.toLowerCase().includes('limit')
    return jsonError(limited ? 'The daily upload limit has been reached.' : 'File could not be reserved. Check that it is a supported CSV under 20 MiB.', limited ? 429 : 400)
  }

  const { data: signed, error: signedError } = await access.admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(reservation.objectKey, { upsert: false })
  if (signedError || !signed) return jsonError('Secure upload could not be prepared. Retry this upload.', 503)

  return NextResponse.json({
    attemptId: reservation.attemptId,
    objectKey: reservation.objectKey,
    token: signed.token,
  })
}

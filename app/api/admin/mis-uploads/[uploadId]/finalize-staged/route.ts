import { after, NextResponse } from 'next/server'
import { jsonError, requireActiveAdmin, uploadsEnabled } from '@/lib/server/mis-upload-admin'
import { ingestionEnabled, kickDrain } from '@/lib/server/mis-gateway-worker'

export const runtime = 'nodejs'
export const maxDuration = 300

type RouteContext = { params: Promise<{ uploadId: string }> }

export async function POST(request: Request, context: RouteContext) {
  if (!uploadsEnabled()) return jsonError('MIS upload intake is not enabled.', 404)
  const access = await requireActiveAdmin(request)
  if ('response' in access) return access.response

  const { uploadId } = await context.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
    return jsonError('Upload receipt was not found.', 404)
  }

  const { data: review, error: reviewError } = await access.admin.rpc('get_mis_upload_review', {
    p_actor_id: access.actorId,
    p_upload_id: uploadId,
  })
  if (reviewError) return jsonError('The staged upload could not be checked. Retry shortly.', 503)
  if (!review?.attemptId || !review?.parse?.id) return jsonError('No resumable staged parse was found.', 409)
  if (!['parsing', 'validated', 'staged'].includes(review.state)) {
    return jsonError(`This upload cannot be finalized from state ${review.state}.`, 409)
  }

  const { data: sealed, error: sealError } = await access.admin.rpc('complete_mis_upload', {
    p_actor_id: access.actorId,
    p_attempt_id: review.attemptId,
    p_parse_id: review.parse.id,
    p_enqueue: false,
  })
  if (sealError) {
    const timedOut = sealError.code === '57014' || /statement timeout|canceling statement/i.test(sealError.message)
    return jsonError(
      timedOut
        ? 'The final integrity step timed out. Staged rows are retained; retry to resume.'
        : 'Staged rows still do not pass the final integrity check. The source is retained for review.',
      timedOut ? 503 : 422,
    )
  }

  const clean = (review.validationSummary ?? []).length === 0
  let pipeline: { batchId: number; invoiceCount: number; state: string } | null = null
  if (ingestionEnabled() && clean && ['validated', 'staged'].includes(sealed.state)) {
    let done = false
    for (let chunk = 0; chunk < 512 && !done; chunk += 1) {
      const { data: queued, error: queueError } = await access.admin.rpc('enqueue_mis_upload_chunk', {
        p_actor_id: access.actorId,
        p_upload_id: sealed.uploadId,
        p_chunk_size: 500,
      })
      if (queueError) {
        if (queueError.code === '22023') {
          await access.admin.rpc('quarantine_mis_upload_enqueue', {
            p_actor_id: access.actorId,
            p_attempt_id: review.attemptId,
            p_upload_id: sealed.uploadId,
            p_error_code: 'invoice_group_validation_failed',
          })
          return jsonError('Invoice-level validation failed. The source is retained in quarantine for review.', 422)
        }
        const timedOut = queueError.code === '57014' || /statement timeout|canceling statement/i.test(queueError.message)
        return jsonError(
          timedOut
            ? 'Invoice validation is taking longer than expected. Progress is saved; retry to continue.'
            : 'Invoice validation could not be completed. Progress is saved; retry to continue.',
          503,
        )
      }
      done = queued?.done === true
      if (done) pipeline = queued
    }
    if (!done) return jsonError('Invoice validation is continuing in saved chunks. Retry to continue.', 503)
    after(async () => { await kickDrain() })
  }

  return NextResponse.json({ ...sealed, pipeline, ingestionEnabled: ingestionEnabled() })
}

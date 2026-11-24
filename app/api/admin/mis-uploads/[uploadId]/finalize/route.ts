import { createHash } from 'node:crypto'
import { after, NextResponse } from 'next/server'
import {
  MIS_CSV_NORMALIZATION_VERSION,
  MIS_CSV_PARSER_VERSION,
  parseMisCsv,
  MisCsvParseError,
} from '@/lib/mis-upload/parser'
import { BUCKET, jsonError, requireActiveAdmin, uploadsEnabled } from '@/lib/server/mis-upload-admin'
import { ingestionEnabled, kickDrain } from '@/lib/server/mis-gateway-worker'

export const runtime = 'nodejs'
export const maxDuration = 300

// The finalize URL contains an attempt ID; use the same dynamic segment name
// as the other upload routes so Next.js has one unambiguous route tree.
type RouteContext = { params: Promise<{ uploadId: string }> }

export async function POST(request: Request, context: RouteContext) {
  if (!uploadsEnabled()) return jsonError('MIS upload intake is not enabled.', 404)
  const access = await requireActiveAdmin(request)
  if ('response' in access) return access.response

  const { uploadId: attemptId } = await context.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)) {
    return jsonError('Upload attempt was not found.', 404)
  }

  const { data: reserved, error: attemptError } = await access.admin.rpc('get_mis_upload_attempt', {
    p_actor_id: access.actorId,
    p_attempt_id: attemptId,
  })
  if (attemptError || !reserved?.object_key) return jsonError('Upload attempt was not found.', 404)

  const { data: source, error: downloadError } = await access.admin.storage
    .from(BUCKET)
    .download(reserved.object_key)
  if (downloadError || !source) return jsonError('Uploaded source file is not available yet.', 409)

  const bytes = new Uint8Array(await source.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (bytes.byteLength !== Number(reserved.byte_count)) {
    const { error } = await access.admin.rpc('ingest_mis_upload', {
      p_actor_id: access.actorId,
      p_attempt_id: attemptId,
      p_source_file_sha256: sha256,
      p_actual_byte_count: bytes.byteLength,
      p_parse: null,
      p_error_code: 'byte_count_mismatch',
    })
    if (error) return jsonError('Stored file did not match the reservation; intake was stopped.', 422)
    return jsonError('Stored file did not match the reservation; evidence was retained for review.', 422)
  }

  let parsed
  try {
    parsed = parseMisCsv(bytes, { referenceYear: new Date().getFullYear() })
  } catch (error) {
    const parseCode = error instanceof MisCsvParseError ? error.code : 'invalid_csv'
    const { data: receipt, error: receiptError } = await access.admin.rpc('ingest_mis_upload', {
      p_actor_id: access.actorId,
      p_attempt_id: attemptId,
      p_source_file_sha256: sha256,
      p_actual_byte_count: bytes.byteLength,
      p_parse: null,
      p_error_code: parseCode,
    })
    if (receiptError) return jsonError('The source could not be staged. Contact an administrator.', 500)
    return NextResponse.json({
      error: 'CSV validation failed. Check the approved headers, encoding and record structure.',
      code: parseCode,
      uploadId: receipt.uploadId,
      state: receipt.state,
    }, { status: 422 })
  }

  const manifest = {
    parserVersion: MIS_CSV_PARSER_VERSION,
    schemaVersion: parsed.schemaVersion,
    normalizationVersion: MIS_CSV_NORMALIZATION_VERSION,
    referenceYear: parsed.referenceYear,
    sourceRowCount: parsed.sourceRowCount,
    blankRecordCount: parsed.blankRecordCount,
    headerSha256: parsed.headerSha256,
    rowsetSha256: parsed.rowsetSha256,
  }
  const { data: ingest, error: ingestError } = await access.admin.rpc('prepare_mis_upload', {
    p_actor_id: access.actorId,
    p_attempt_id: attemptId,
    p_sha256: sha256,
    p_byte_count: bytes.byteLength,
    p_manifest: manifest,
  })
  if (ingestError) return jsonError('The validated CSV could not be recorded.', 500)

  const issuesByRow = new Map<number, typeof parsed.issues>()
  for (const issue of parsed.issues) {
    const issues = issuesByRow.get(issue.sourceRowNumber) ?? []
    issues.push(issue)
    issuesByRow.set(issue.sourceRowNumber, issues)
  }

  for (let offset = 0; !ingest.sealed && offset < parsed.rows.length; offset += 250) {
    const batch = parsed.rows.slice(offset, offset + 250).map((row) => ({
      sourceRowNumber: row.sourceRowNumber,
      rawCells: row.rawCells,
      normalizedValues: row.normalizedValues,
      rowSha256: row.rowSha256,
      issues: (issuesByRow.get(row.sourceRowNumber) ?? []).map(({ field, code }) => ({ field, code })),
    }))
    const expectedChunkSha256 = createHash('sha256')
      .update(batch.map((row) => `${row.sourceRowNumber}:${row.rowSha256}\n`).join(''), 'utf8')
      .digest('hex')
    const { error } = await access.admin.rpc('stage_mis_upload_rows_checked', {
      p_actor_id: access.actorId,
      p_attempt_id: attemptId,
      p_parse_id: ingest.parseId,
      p_rows: batch,
      p_expected_chunk_sha256: expectedChunkSha256,
    })
    if (error) return jsonError('Some source rows could not be staged. The upload is retained and can be retried.', 503)
  }

  const enqueue = ingestionEnabled() && parsed.issues.length === 0
  const { data: sealed, error: sealError } = await access.admin.rpc('complete_mis_upload', {
    p_actor_id: access.actorId,
    p_attempt_id: attemptId,
    p_parse_id: ingest.parseId,
    p_enqueue: false,
  })
  if (sealError) {
    const timedOut = sealError.code === '57014' || /statement timeout|canceling statement/i.test(sealError.message)
    return jsonError(
      timedOut
        ? 'The final integrity step timed out. Staged rows are retained; retry to resume.'
        : 'Staged rows did not pass the final integrity check. The upload is retained for review.',
      timedOut ? 503 : 422,
    )
  }

  let pipeline: { batchId: number; invoiceCount: number; state: string } | null = null
  if (enqueue && ['validated', 'staged'].includes(sealed.state)) {
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
            p_attempt_id: attemptId,
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

  const issueCounts = parsed.issues.reduce<Record<string, number>>((counts, issue) => {
    const key = `${issue.field}:${issue.code}`
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
  const validationSummary = Object.entries(issueCounts).map(([issue, count]) => ({ issue, count }))

  return NextResponse.json({
    ...sealed,
    pipeline,
    duplicate: ingest.duplicate,
    validRowCount: parsed.sourceRowCount - new Set(parsed.issues.map((issue) => issue.sourceRowNumber)).size,
    rejectedRowCount: new Set(parsed.issues.map((issue) => issue.sourceRowNumber)).size,
    blankRecordCount: parsed.blankRecordCount,
    validationSummary,
  })
}

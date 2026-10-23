import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  MIS_CSV_NORMALIZATION_VERSION,
  MIS_CSV_PARSER_VERSION,
  parseMisCsv,
  MisCsvParseError,
} from '@/lib/mis-upload/parser'
import { BUCKET, jsonError, requireActiveAdmin, uploadsEnabled } from '@/lib/server/mis-upload-admin'

export const runtime = 'nodejs'
export const maxDuration = 300

type RouteContext = { params: Promise<{ attemptId: string }> }

export async function POST(request: Request, context: RouteContext) {
  if (!uploadsEnabled()) return jsonError('MIS upload intake is not enabled.', 404)
  const access = await requireActiveAdmin(request)
  if ('response' in access) return access.response

  const { attemptId } = await context.params
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
    parsed = parseMisCsv(bytes)
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
      error: error instanceof Error ? error.message : 'CSV validation failed.',
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
  const { data: ingest, error: ingestError } = await access.admin.rpc('ingest_mis_upload', {
    p_actor_id: access.actorId,
    p_attempt_id: attemptId,
    p_source_file_sha256: sha256,
    p_actual_byte_count: bytes.byteLength,
    p_parse: manifest,
    p_error_code: null,
  })
  if (ingestError) return jsonError('The validated CSV could not be recorded.', 500)
  if (ingest.duplicate) {
    // The existing receipt already retains the exact same bytes by hash; this
    // reservation's path is therefore an unreferenced duplicate object.
    await access.admin.storage.from(BUCKET).remove([reserved.object_key])
    return NextResponse.json({ ...ingest, validationCount: 0 })
  }

  const issuesByRow = new Map<number, typeof parsed.issues>()
  for (const issue of parsed.issues) {
    const issues = issuesByRow.get(issue.sourceRowNumber) ?? []
    issues.push(issue)
    issuesByRow.set(issue.sourceRowNumber, issues)
  }

  for (let offset = 0; offset < parsed.rows.length; offset += 250) {
    const batch = parsed.rows.slice(offset, offset + 250).map((row) => ({
      sourceRowNumber: row.sourceRowNumber,
      rawCells: row.rawCells,
      normalizedValues: row.normalizedValues,
      rowSha256: row.rowSha256,
      issues: (issuesByRow.get(row.sourceRowNumber) ?? []).map(({ field, code }) => ({ field, code })),
    }))
    const { error } = await access.admin.rpc('stage_mis_upload_rows', {
      p_actor_id: access.actorId,
      p_attempt_id: attemptId,
      p_parse_id: ingest.parseId,
      p_rows: batch,
    })
    if (error) return jsonError('Some source rows could not be staged. The upload is retained and can be retried.', 503)
  }

  const { data: sealed, error: sealError } = await access.admin.rpc('seal_mis_upload_parse', {
    p_actor_id: access.actorId,
    p_attempt_id: attemptId,
    p_parse_id: ingest.parseId,
  })
  if (sealError) return jsonError('Staged rows did not pass the final integrity check. The upload is retained for review.', 422)

  return NextResponse.json({
    ...sealed,
    validRowCount: parsed.sourceRowCount - new Set(parsed.issues.map((issue) => issue.sourceRowNumber)).size,
    rejectedRowCount: new Set(parsed.issues.map((issue) => issue.sourceRowNumber)).size,
    blankRecordCount: parsed.blankRecordCount,
  })
}

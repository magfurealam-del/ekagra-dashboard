'use client'

import { ChangeEvent, Fragment, useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { supabase } from '@/lib/supabase'

type UploadItem = {
  uploadId: string
  fileName: string
  sha256: string
  byteCount: number
  receivedAt: string
  state: string
  sourceRowCount: number | null
  blankRecordCount: number | null
  validationCount: number
}

type Reservation = { attemptId: string; objectKey: string; token: string }
type Pipeline = { batchId: number; invoices: number; completed: number; superseded: number; failed: number; pending: number; attempts: number; published: boolean; publicationStage: string; errorCodes: string[]; publicationResult: { status?: string; code?: string } }
type UploadReview = {
  uploadId: string
  fileName: string
  sha256: string
  byteCount: number
  receivedAt: string
  state: string
  parse: null | {
    status: string
    parserVersion: string
    schemaVersion: string
    normalizationVersion: string
    referenceYear: number
    sourceRowCount: number
    blankRecordCount: number
    headerSha256: string
    rowsetSha256: string
    createdAt: string
    sealedAt: string | null
  }
  rowCounts: Record<string, number>
  validationSummary: Array<{ field: string; code: string; outcome: string; count: number }>
}
type CandidatePreview = {
  mode: 'diagnostic_only'
  canonicalWriteAllowed: false
  sourceAuthorityPresent: false
  reason: string
  invoiceCount: number
  sourceRowCount: number
  classifications: Record<string, { invoices: number; sourceRows: number; currentRows: number }>
}

function readableBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

export default function MisUploadAdminPage() {
  const { session, profile, loading } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [referenceYear, setReferenceYear] = useState<number | null>(null)
  const [expandedReview, setExpandedReview] = useState<string | null>(null)
  const [reviewDetails, setReviewDetails] = useState<Record<string, UploadReview>>({})
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState('')
  const [candidatePreviews, setCandidatePreviews] = useState<Record<string, CandidatePreview>>({})
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [pipelines, setPipelines] = useState<Record<string, Pipeline | null>>({})
  const [ingestionEnabled, setIngestionEnabled] = useState(false)

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const { data: { session: current } } = await supabase.auth.getSession()
    if (!current?.access_token) throw new Error('Your session has expired. Sign in again.')
    return { Authorization: `Bearer ${current.access_token}` }
  }, [])

  const loadUploads = useCallback(async () => {
    try {
      const headers = await authHeaders()
      const response = await fetch('/api/admin/mis-uploads', { headers, cache: 'no-store' })
      if (response.status === 404) {
        setEnabled(false)
        setStatus('MIS Uploads is not enabled in this environment yet.')
        return
      }
      if (!response.ok) throw new Error('Upload history could not be loaded.')
      const body = await response.json()
      setUploads(body.uploads as UploadItem[])
      setEnabled(true)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload history could not be loaded.')
    }
  }, [authHeaders])

  useEffect(() => {
    if (!session || profile?.role !== 'admin' || !profile.is_active) return
    const timer = window.setTimeout(() => { void loadUploads() }, 0)
    return () => window.clearTimeout(timer)
  }, [session, profile?.id, profile?.role, profile?.is_active, loadUploads])

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null
    setFile(selected)
    setStatus('')
  }

  async function toggleReview(uploadId: string) {
    if (expandedReview === uploadId) {
      setExpandedReview(null)
      setReviewError('')
      return
    }
    setExpandedReview(uploadId)
    setReviewError('')

    setReviewing(uploadId)
    try {
      const headers = await authHeaders()
      const response = await fetch(`/api/admin/mis-uploads/${uploadId}`, { headers, cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Review details could not be loaded.')
      setReviewDetails((current) => ({ ...current, [uploadId]: body.review as UploadReview }))
      const pipelineResponse = await fetch(`/api/admin/mis-uploads/${uploadId}/pipeline`, { headers, cache: 'no-store' })
      if (!pipelineResponse.ok) throw new Error('Pipeline status is unavailable.')
      const pipelineBody = await pipelineResponse.json()
      setPipelines((current) => ({ ...current, [uploadId]: pipelineBody.pipeline }))
      setIngestionEnabled(pipelineBody.ingestionEnabled)
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Review details could not be loaded.')
    } finally {
      setReviewing(null)
    }
  }

  async function pipelineAction(uploadId: string, action: 'enqueue' | 'retry') {
    setReviewing(uploadId)
    setReviewError('')
    try {
      const headers = await authHeaders()
      const response = await fetch(`/api/admin/mis-uploads/${uploadId}/pipeline`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Pipeline action failed.')
      const refreshed = await fetch(`/api/admin/mis-uploads/${uploadId}/pipeline`, { headers, cache: 'no-store' })
      if (!refreshed.ok) throw new Error('Pipeline status is unavailable.')
      const body = await refreshed.json()
      setPipelines(current => ({ ...current, [uploadId]: body.pipeline }))
      setStatus('Queued for reconciliation during the overnight processing window. Reopen Review to refresh progress.')
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Pipeline action failed.')
    } finally { setReviewing(null) }
  }

  async function compareCandidates(uploadId: string) {
    setPreviewError('')
    setPreviewing(uploadId)
    try {
      const headers = await authHeaders()
      const response = await fetch(`/api/admin/mis-uploads/${uploadId}/preview`, {
        method: 'POST',
        headers,
        cache: 'no-store',
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Candidate comparison could not be generated.')
      setCandidatePreviews((current) => ({ ...current, [uploadId]: body.preview as CandidatePreview }))
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Candidate comparison could not be generated.')
    } finally {
      setPreviewing(null)
    }
  }

  async function submitUpload() {
    if (!file) return
    setBusy(true)
    setStatus('Preparing secure upload…')
    try {
      const headers = await authHeaders()
      const reservationResponse = await fetch('/api/admin/mis-uploads', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          byteCount: file.size,
          mediaType: file.type || 'application/octet-stream',
          requestIdempotencyKey: crypto.randomUUID(),
        }),
      })
      const reservationBody = await reservationResponse.json()
      if (!reservationResponse.ok) throw new Error(reservationBody.error ?? 'Upload could not be reserved.')
      const reservation = reservationBody as Reservation

      setStatus('Uploading original CSV to private storage…')
      const { error: storageError } = await supabase.storage
        .from('mis-upload-source')
        .uploadToSignedUrl(reservation.objectKey, reservation.token, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        })
      if (storageError) throw new Error('The source file could not be uploaded. Retry with a new attempt.')

      setStatus('Verifying and staging rows. Large files may take a few minutes…')
      const finalizeResponse = await fetch(`/api/admin/mis-uploads/${reservation.attemptId}/finalize`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ referenceYear }),
      })
      const result = await finalizeResponse.json()
      if (!finalizeResponse.ok) throw new Error(result.error ?? 'CSV could not be staged.')

      setStatus(`${result.duplicate ? 'Existing source receipt resumed. ' : ''}Upload ${result.state}: ${result.sourceRowCount ?? 0} source rows, ${result.rejectedRowCount ?? 0} rows need review. ${result.pipeline ? `${result.pipeline.invoiceCount} invoices queued for overnight reconciliation.` : result.pipelineError ?? 'Source retained; ingestion has not been queued.'}${result.validationSummary?.length ? ` Validation issues: ${result.validationSummary.map((item: { issue: string; count: number }) => `${item.issue} (${item.count})`).join(', ')}.` : ''}`)
      setFile(null)
      const input = document.getElementById('mis-upload-file') as HTMLInputElement | null
      if (input) input.value = ''
      await loadUploads()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload failed. The source may have been retained; check history before retrying.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <main className="mx-auto max-w-5xl p-8 text-slate-600">Loading…</main>
  if (!session || profile?.role !== 'admin' || !profile.is_active) {
    return <main className="mx-auto max-w-5xl p-8 text-slate-700">Active administrator access required.</main>
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6 lg:p-10">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Administration</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">MIS Uploads</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Upload the approved MIS CSV export. The gateway preserves the original file, verifies its hash,
          and validates each invoice before queueing MIS and downstream reconciliation. Each invoice in the
          file is treated as a complete authoritative snapshot, including historical corrections.
          Invoices absent from the file are retained. Original files and previous invoice versions are preserved.
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Upload source file</h2>
        <p className="mt-1 text-sm text-slate-600">CSV only · UTF-8 · up to 20 MiB · approved 32-column MIS export.</p>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm font-medium text-slate-700" htmlFor="mis-upload-file">
            MIS CSV file
            <input
              id="mis-upload-file"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={chooseFile}
              className="mt-2 block w-full rounded-lg border border-slate-300 p-3 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-teal-50 file:px-4 file:py-2 file:font-semibold file:text-teal-800"
            />
          </label>
          <label className="w-full text-sm font-medium text-slate-700 sm:w-48" htmlFor="mis-upload-reference-year">
            Age reference year
            <input
              id="mis-upload-reference-year"
              type="number"
              min={1890}
              max={2200}
              step={1}
              required
              value={referenceYear ?? ''}
              disabled={busy}
              onChange={(event) => setReferenceYear(event.target.value === '' ? null : Number(event.target.value))}
              className="mt-2 block w-full rounded-lg border border-slate-300 p-3 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={submitUpload}
            disabled={
              !enabled ||
              !file ||
              busy ||
              file.size > 20 * 1024 * 1024 ||
              !file.name.toLowerCase().endsWith('.csv') ||
              referenceYear === null ||
              !Number.isInteger(referenceYear) ||
              referenceYear < 1890 ||
              referenceYear > 2200
            }
            className="rounded-lg bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy ? 'Processing…' : 'Upload and reconcile'}
          </button>
        </div>
        {file && <p className="mt-3 text-sm text-slate-600">Selected: {file.name} · {readableBytes(file.size)}</p>}
        {status && <p role="status" className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{status}</p>}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Recent source receipts</h2>
          <p className="mt-1 text-sm text-slate-500">Source history and staging status. Patient details are not displayed here.</p>
        </div>
        {uploads.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No uploads to show, or intake is not enabled yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-6 py-3">File</th><th className="px-6 py-3">Received</th><th className="px-6 py-3">Rows</th><th className="px-6 py-3">Review items</th><th className="px-6 py-3">State</th><th className="px-6 py-3">Details</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {uploads.map((upload) => (
                  <Fragment key={upload.uploadId}>
                  <tr>
                    <td className="px-6 py-4 font-medium text-slate-800">{upload.fileName}<div className="mt-1 text-xs text-slate-500">{readableBytes(upload.byteCount)}</div></td>
                    <td className="px-6 py-4 text-slate-600">{new Date(upload.receivedAt).toLocaleString()}</td>
                    <td className="px-6 py-4 text-slate-600">{upload.sourceRowCount ?? '—'}</td>
                    <td className="px-6 py-4 text-slate-600">{upload.validationCount}</td>
                    <td className="px-6 py-4"><span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold capitalize text-teal-800">{upload.state}</span></td>
                    <td className="px-6 py-4">
                      <button type="button" onClick={() => void toggleReview(upload.uploadId)} className="font-semibold text-teal-800 underline">
                        {reviewing === upload.uploadId ? 'Loading…' : expandedReview === upload.uploadId ? 'Hide' : 'Review'}
                      </button>
                    </td>
                  </tr>
                  {expandedReview === upload.uploadId && (
                    <tr>
                      <td colSpan={6} className="bg-slate-50 px-6 py-5">
                        {reviewError && <p role="alert" className="text-sm text-rose-700">{reviewError}</p>}
                        {!reviewError && !reviewDetails[upload.uploadId] && <p className="text-sm text-slate-600">Loading protected review details…</p>}
                        {reviewDetails[upload.uploadId] && (() => {
                          const detail = reviewDetails[upload.uploadId]
                          return (
                            <div className="space-y-4 text-sm">
                              <p className="text-slate-700">Original source and previous invoice versions are retained. Processing runs overnight (00:15–07:45 Asia/Dhaka); queued does not mean reconciled.</p>
                              {pipelines[upload.uploadId] ? (() => {
                                const pipeline = pipelines[upload.uploadId]!
                                return <div className="space-y-2 rounded-lg border border-teal-200 bg-white p-4">
                                  <p className="font-semibold">{pipeline.published ? 'Reconciled and published' : 'Reconciliation in progress'}</p>
                                  <p>{pipeline.completed} completed · {pipeline.pending} pending · {pipeline.failed} failed · {pipeline.superseded} superseded · {pipeline.invoices} invoices</p>
                                  <p>Downstream publication: {pipeline.publicationStage}. Reopen Review to refresh.</p>
                                  {pipeline.errorCodes?.length > 0 && <p role="alert">Processing checks: {pipeline.errorCodes.join(', ')}. {pipeline.errorCodes.includes('23503') ? 'Inventory-linked lines require review before replacement.' : 'An administrator should inspect the failed job before retrying.'}</p>}
                                  {pipeline.publicationResult?.status === 'failed' && <p role="alert">Downstream refresh failed ({pipeline.publicationResult.code}); the batch is not published.</p>}
                                  {pipeline.failed > 0 && <button disabled={!ingestionEnabled || reviewing === upload.uploadId} onClick={() => void pipelineAction(upload.uploadId, 'retry')} className="font-semibold text-teal-800 underline disabled:opacity-50">Retry failed invoices</button>}
                                </div>
                              })() : <button disabled={!ingestionEnabled || reviewing === upload.uploadId || detail.state !== 'validated'} onClick={() => void pipelineAction(upload.uploadId, 'enqueue')} className="font-semibold text-teal-800 underline disabled:opacity-50">{ingestionEnabled ? 'Queue validated invoices' : 'Ingestion activation pending'}</button>}
                              {detail.parse ? (
                                <>
                                  <div>
                                    <button type="button" onClick={() => void compareCandidates(upload.uploadId)} disabled={previewing === upload.uploadId} className="rounded-md border border-teal-700 px-3 py-2 font-semibold text-teal-800 disabled:opacity-50">
                                      {previewing === upload.uploadId ? 'Comparing…' : 'Compare candidate totals'}
                                    </button>
                                  </div>
                                  {previewError && <p role="alert" className="text-rose-700">{previewError}</p>}
                                  {candidatePreviews[upload.uploadId] && (
                                    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4">
                                      <p className="font-semibold text-amber-900">Totals comparison only</p>
                                      <p className="text-amber-900">These diagnostic counts compare row counts and financial aggregates. The ingestion worker separately compares complete row contents before applying an invoice.</p>
                                      <p className="text-amber-900">{candidatePreviews[upload.uploadId].invoiceCount} invoices · {candidatePreviews[upload.uploadId].sourceRowCount} source rows</p>
                                      <ul className="list-inside list-disc text-amber-900">
                                        {Object.entries(candidatePreviews[upload.uploadId].classifications).map(([name, counts]) => <li key={name}>{name.replaceAll('_', ' ')}: {counts.invoices} invoices, {counts.sourceRows} source rows, {counts.currentRows} current rows</li>)}
                                      </ul>
                                    </div>
                                  )}
                                  <p className="text-slate-600">Parser {detail.parse.parserVersion} · schema {detail.parse.schemaVersion} · normalization {detail.parse.normalizationVersion} · age reference year {detail.parse.referenceYear}</p>
                                  <p className="text-slate-600">{detail.parse.sourceRowCount} source rows · {detail.parse.blankRecordCount} blank records · {Object.entries(detail.rowCounts).map(([name, count]) => `${name}: ${count}`).join(' · ') || 'No staged rows'}</p>
                                  {detail.validationSummary.length > 0 ? (
                                    <div className="overflow-x-auto">
                                      <table className="w-full max-w-3xl text-left">
                                        <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Field</th><th className="py-2">Finding</th><th className="py-2">Outcome</th><th className="py-2 text-right">Rows</th></tr></thead>
                                        <tbody className="divide-y divide-slate-200">{detail.validationSummary.map((item) => <tr key={`${item.field}-${item.code}-${item.outcome}`}><td className="py-2">{item.field}</td><td className="py-2">{item.code}</td><td className="py-2 capitalize">{item.outcome}</td><td className="py-2 text-right">{item.count}</td></tr>)}</tbody>
                                      </table>
                                    </div>
                                  ) : <p className="text-emerald-700">No parser validation findings.</p>}
                                </>
                              ) : <p className="text-slate-600">No parse is available for this source receipt yet.</p>}
                            </div>
                          )
                        })()}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}

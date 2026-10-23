'use client'

import { ChangeEvent, useCallback, useEffect, useState } from 'react'
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
      setStatus('')
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
        method: 'POST', headers,
      })
      const result = await finalizeResponse.json()
      if (!finalizeResponse.ok) throw new Error(result.error ?? 'CSV could not be staged.')

      setStatus(result.duplicate
        ? 'Exact duplicate file found. The existing receipt and staging record remain authoritative.'
        : `Upload ${result.state}: ${result.sourceRowCount ?? 0} source rows, ${result.blankRecordCount ?? 0} blank rows, ${result.rejectedRowCount ?? 0} rows need review. Canonical MIS data was not changed.`)
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
          and stages a versioned parse for review. This intake does not change canonical MIS, finance,
          CRM, clinical verification, or dashboard data.
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
          <button
            type="button"
            onClick={submitUpload}
            disabled={!enabled || !file || busy || file.size > 20 * 1024 * 1024 || !file.name.toLowerCase().endsWith('.csv')}
            className="rounded-lg bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy ? 'Processing…' : 'Upload and validate'}
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
                <tr><th className="px-6 py-3">File</th><th className="px-6 py-3">Received</th><th className="px-6 py-3">Rows</th><th className="px-6 py-3">Review items</th><th className="px-6 py-3">State</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {uploads.map((upload) => (
                  <tr key={upload.uploadId}>
                    <td className="px-6 py-4 font-medium text-slate-800">{upload.fileName}<div className="mt-1 text-xs text-slate-500">{readableBytes(upload.byteCount)}</div></td>
                    <td className="px-6 py-4 text-slate-600">{new Date(upload.receivedAt).toLocaleString()}</td>
                    <td className="px-6 py-4 text-slate-600">{upload.sourceRowCount ?? '—'}</td>
                    <td className="px-6 py-4 text-slate-600">{upload.validationCount}</td>
                    <td className="px-6 py-4"><span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold capitalize text-teal-800">{upload.state}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}

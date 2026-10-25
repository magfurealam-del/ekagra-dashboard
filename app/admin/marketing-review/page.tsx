'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { supabase } from '@/lib/supabase'
import { humanize, pipelineLabel, type CorrectionPayload, type LeadMatch, type MetaRow, type Pipeline, type RevenueRow, type ReviewDetail, type ReviewKind, type ReviewQueue } from '@/lib/marketing-review/types'
import { validateCorrection } from '@/lib/marketing-review/validation'

const money = (n: number | string) => `৳${Number(n).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const date = (s?: string | null) => s ? new Date(s.length === 10 ? `${s}T00:00:00+06:00` : s).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric' }) : 'Not recorded'
const input = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-100'
const button = 'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50'
const reasonDescriptions: Record<string, string> = {
  independent_identity_evidence_missing: 'Phone matches alone do not establish who received treatment. Verify the patient against independent evidence.',
  no_matching_crm_contact: 'Find an existing CRM lead or record a verified intake through the lead intake page, then return here. Do not create a lead solely to close this case.',
  original_message_direction_unverified: 'The original inbound direction is unverified. A projected sender field is not proof that the patient sent the message.',
  shared_phone_or_conflicting_patient_links: 'This phone is linked to more than one identity. Verify the hospital number and explain which patient this conversation concerns.',
  proxy_patient_relationship_needs_review: 'The sender may be a relative or caregiver. Establish which patient the original acquisition concerned before confirming.',
  messenger_contact_phone_conflict: 'The contact and extracted phone disagree. Review the original conversation and hospital identity.',
  no_verified_patient_phone_owner: 'No verified patient owns this number. Find and independently verify a canonical patient before linking.',
  late_source: 'The source was recorded after the first clinical invoice. Keep the original date unless earlier acquisition evidence can be verified.',
  pre_acquisition_invoice: 'These invoices predate the verified acquisition. They remain unattributed unless earlier original acquisition evidence is verified.',
  outbound_only: 'Outbound follow-up is not an acquisition. Verify a separate original inbound source, if one exists.',
  missing_source: 'No qualifying acquisition source is recorded. Verify the patient, original source and original event date.',
  identity_conflict: 'Source records contain conflicting patient links. Replace only evidence the team has verified to be incorrect.',
}
type SaveRequest = { kind: ReviewKind; id: number; version: string; requestId: string; payload: CorrectionPayload }
class ReviewApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export default function MarketingReviewPage() {
  const { session, profile, loading } = useAuth()
  const allowed = !!session && profile?.role === 'admin' && profile.is_active
  const [kind, setKind] = useState<ReviewKind>('meta')
  const [queue, setQueue] = useState<ReviewQueue | null>(null)
  const [page, setPage] = useState(0)
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [detail, setDetail] = useState<ReviewDetail | null>(null)
  const [recordsPage, setRecordsPage] = useState(0)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadingQueue, setLoadingQueue] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [action, setAction] = useState('needs_review')
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const [verifiedHn, setVerifiedHn] = useState('')
  const [attested, setAttested] = useState(false)
  const [source, setSource] = useState('facebook')
  const [eventDate, setEventDate] = useState('')
  const [excluded, setExcluded] = useState<Array<{ table: string; id: string }>>([])
  const [leadQuery, setLeadQuery] = useState('')
  const [matches, setMatches] = useState<LeadMatch[]>([])
  const [lead, setLead] = useState<LeadMatch | null>(null)
  const [searchingLeads, setSearchingLeads] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<SaveRequest | null>(null)
  const selectionSequence = useRef(0)
  const detailHeading = useRef<HTMLHeadingElement>(null)

  const api = useCallback(async <T,>(params: string, options?: RequestInit): Promise<T> => {
    const { data: { session: current } } = await supabase.auth.getSession()
    if (!current) throw new Error('Your session expired. Sign in again.')
    const response = await fetch(`/api/admin/marketing-reviews${params}`, {
      ...options, cache: 'no-store', headers: { Authorization: `Bearer ${current.access_token}`, 'Content-Type': 'application/json' },
    })
    const body = await response.json()
    if (!response.ok) throw new ReviewApiError(body.error || 'The review request failed.', response.status)
    return body as T
  }, [])
  const refreshQueue = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams({ kind, page: String(page), filter, search: query })
    const result = await api<ReviewQueue>(`?${params}`, { signal })
    setQueue(result)
  }, [api, kind, page, filter, query])
  useEffect(() => {
    if (!allowed) return
    const controller = new AbortController()
    const initial = window.setTimeout(() => {
      setLoadingQueue(true)
      refreshQueue(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e.message) }).finally(() => { if (!controller.signal.aborted) setLoadingQueue(false) })
    }, 0)
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshQueue(controller.signal).catch(() => {})
    }, 15000)
    return () => { controller.abort(); window.clearTimeout(initial); window.clearInterval(poll) }
  }, [allowed, refreshQueue])

  const openCase = useCallback(async (id: number) => {
    const sequence = ++selectionSequence.current
    setSelected(id); setDetail(null); setLoadingDetail(true); setError(''); setNotice(''); setPending(null)
    setReason(''); setReference(''); setVerifiedHn(''); setAttested(false); setAction('needs_review'); setLead(null)
    setLeadQuery(''); setMatches([]); setRecordsPage(0); setExcluded([]); setEventDate('')
    try {
      const result = await api<ReviewDetail>(`?kind=${kind}&id=${id}`)
      if (sequence !== selectionSequence.current) return
      setDetail(result); setMatches(result.matches || [])
      setExcluded(result.sourceCorrection?.active ? result.sourceCorrection.excluded_evidence : [])
      setSource(result.sourceCorrection?.source || 'facebook')
      setEventDate(result.sourceCorrection?.event_date || '')
      detailHeading.current?.focus({ preventScroll: true })
    } catch (e) { if (sequence === selectionSequence.current) setError(e instanceof Error ? e.message : 'Could not load the case.') }
    finally { if (sequence === selectionSequence.current) setLoadingDetail(false) }
  }, [api, kind])

  const switchKind = (next: ReviewKind) => {
    if (saving || pending) return
    ++selectionSequence.current
    setKind(next); setQueue(null); setPage(0); setFilter(''); setSearch(''); setQuery(''); setSelected(null); setDetail(null); setError(''); setNotice(''); setPending(null)
  }
  async function searchLeads() {
    if (leadQuery.trim().length < 2) return
    const sequence = selectionSequence.current
    setSearchingLeads(true); setError('')
    try { const results = await api<LeadMatch[]>(`?kind=leads&search=${encodeURIComponent(leadQuery.trim())}`); if (sequence === selectionSequence.current) setMatches(results) }
    catch (e) { setError(e instanceof Error ? e.message : 'Search failed.') }
    finally { setSearchingLeads(false) }
  }
  async function moreRecords() {
    if (!selected || !detail) return
    const sequence = selectionSequence.current
    setLoadingDetail(true)
    try {
      const result = await api<ReviewDetail>(`?kind=${kind}&id=${selected}&page=${recordsPage + 1}`)
      if (sequence !== selectionSequence.current) return
      setDetail(old => old ? { ...old, messages: [...(old.messages || []), ...(result.messages || [])], invoices: [...(old.invoices || []), ...(result.invoices || [])],
        originalRecords: result.originalRecords ? { ...result.originalRecords, items: [...(old.originalRecords?.items || []), ...result.originalRecords.items] } : old.originalRecords } : old)
      setRecordsPage(n => n + 1)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load more records.') }
    finally { setLoadingDetail(false) }
  }
  async function save() {
    if (!detail || !selected) return
    const payload: CorrectionPayload = { action, reason, evidenceReference: reference, verifiedHn, attested }
    if (kind === 'meta') { payload.leadId = lead?.id; payload.leadVersion = lead?.version }
    else { payload.source = source; payload.eventDate = eventDate; payload.excludedEvidence = excluded }
    const invalid = pending ? null : validateCorrection(kind, payload)
    if (invalid) { setError(invalid); return }
    const request = pending || { kind, id: selected, version: detail.version, requestId: crypto.randomUUID(), payload }
    setPending(request); setSaving(true); setError(''); setNotice('')
    try {
      await api<{ sourceRevision: number }>('', { method: 'POST', body: JSON.stringify(request) })
      setPending(null)
      await openCase(selected)
      setNotice('Decision saved with an audit trail. Downstream reconciliation has been queued automatically.')
      await refreshQueue()
    } catch (e) {
      if (e instanceof ReviewApiError && [400,409,413].includes(e.status)) setPending(null)
      setError(`${e instanceof Error ? e.message : 'Save interrupted.'} ${e instanceof ReviewApiError && [400,409,413].includes(e.status) ? 'Correct the input or reload the case before saving again.' : 'You can retry this same request or reload the case to check its history.'}`)
    }
    finally { setSaving(false) }
  }

  if (loading) return <main className="mx-auto max-w-7xl p-8 text-slate-600">Loading administrator access…</main>
  if (!allowed) return <main className="mx-auto max-w-7xl p-8 text-slate-700">Active administrator access required.</main>
  const pipeline: Pipeline | undefined = queue?.pipeline || detail?.pipeline
  const revenue = detail?.revenue || []
  const firstClinical = revenue.find(r => r.first_clinical_date)?.first_clinical_date
  const verification = ['confirm','duplicate','verify_source'].includes(action)
  const list = queue?.items || []

  return <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-7 text-slate-900 sm:px-6 lg:px-10">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Ekagra · Administration</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Attribution review</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Verify Meta identities and original acquisition evidence. Every decision is recorded, and corrections flow through the MIS reconciliation pipeline automatically.</p>
      </div>
      <Link href="/admin/mis-upload" className={button}>MIS uploads ↗</Link>
    </header>
    <section aria-label="Reconciliation status" className={`rounded-xl border px-5 py-4 ${pipeline?.current ? 'border-teal-200 bg-teal-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{pipeline ? pipelineLabel(pipeline) : 'Loading reconciliation status…'}</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">Corrections are saved immediately. The worker runs during 00:15–07:45 Dhaka time; the scheduled worker retries interrupted runs.</p>
          {pipeline?.snapshotAt && <p className="text-xs text-slate-600">Revenue queue: last validated publication on {date(pipeline.snapshotAt)}. {pipeline.current ? 'Current source changes are published.' : 'Amounts remain at that publication until reconciliation finishes.'}</p>}
        </div>
        <button className={button} onClick={() => refreshQueue().catch(e => setError(e.message))} disabled={loadingQueue}>Refresh status</button>
      </div>
    </section>
    <div className="grid gap-3 sm:grid-cols-2">
      <button onClick={() => switchKind('meta')} aria-pressed={kind === 'meta'} className={`rounded-xl border p-5 text-left transition ${kind === 'meta' ? 'border-teal-600 bg-teal-50 ring-1 ring-teal-600' : 'border-slate-200 bg-white hover:border-teal-300'}`}>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Meta identity queue</span>
        <p className="mt-2 text-xl font-bold">{kind === 'meta' && queue ? `${queue.open?.toLocaleString()} open cases` : 'Review Meta cases'} <span aria-hidden="true" className="float-right text-teal-700">→</span></p>
        <p className="mt-1 text-sm text-slate-600">Original messages, CRM matches and patient identity.</p>
      </button>
      <button onClick={() => switchKind('revenue')} aria-pressed={kind === 'revenue'} className={`rounded-xl border p-5 text-left transition ${kind === 'revenue' ? 'border-teal-600 bg-teal-50 ring-1 ring-teal-600' : 'border-slate-200 bg-white hover:border-teal-300'}`}>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unattributed revenue queue</span>
        <p className="mt-2 text-xl font-bold">{kind === 'revenue' && queue ? money(queue.netBill || 0) : 'Review acquisition sources'} <span aria-hidden="true" className="float-right text-teal-700">→</span></p>
        <p className="mt-1 text-sm text-slate-600">{kind === 'revenue' && queue ? `${queue.patients} patients · ${queue.total} patient / reason cases in this view` : 'Missing, conflicting and late acquisition evidence.'}</p>
      </button>
    </div>
    {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
    {notice && <div role="status" className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">{notice}</div>}
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.3fr)]">
      <section aria-label="Review queue" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="space-y-3 border-b border-slate-200 p-4">
          <h2 className="font-semibold">{kind === 'meta' ? 'Meta identity cases' : 'Revenue by patient'}</h2>
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); setPage(0); setQuery(search.trim()) }}>
            <label className="flex-1 text-xs font-medium text-slate-600">{kind === 'meta' ? 'Search phone or case ID' : 'Search patient, HN or name'}
              <input value={search} onChange={e => setSearch(e.target.value)} maxLength={100} className={input} placeholder={kind === 'meta' ? 'Phone / case ID' : 'HN / patient name'} />
            </label>
            <button type="submit" className={`${button} self-end`}>Search</button>
          </form>
          <label className="block text-xs font-medium text-slate-600">Filter queue
            <select value={filter} onChange={e => { setFilter(e.target.value); setPage(0) }} className={input}>
              <option value="">{kind === 'meta' ? 'Open cases' : 'All attribution reasons'}</option>
              {kind === 'meta' && <><option value="all">All cases, including reviewed</option><option value="resolved">Reviewed / closed</option></>}
              {Object.entries(queue?.reasons || {}).map(([r, n]) => <option key={r} value={r}>{humanize(r)} ({n})</option>)}
            </select>
          </label>
          <p className="text-xs text-slate-500" aria-live="polite">{loadingQueue ? 'Loading queue…' : `${queue?.total || 0} matching cases · sorted ${kind === 'revenue' ? 'by revenue at risk' : 'oldest first'}`}</p>
        </div>
        <div className="max-h-[750px] divide-y divide-slate-100 overflow-y-auto">
          {!list.length && !loadingQueue && <p className="p-8 text-sm text-slate-500">No cases match this filter. {kind === 'revenue' && !pipeline?.snapshotAt ? 'The first validated publication is still pending.' : ''}</p>}
          {list.map(row => {
            const m = row as MetaRow, r = row as RevenueRow
            const id = kind === 'meta' ? m.id : r.patient_id
            return <button key={kind === 'meta' ? String(m.id) : `${r.patient_id}:${r.reason}`} onClick={() => openCase(id)} disabled={saving || !!pending} aria-pressed={selected === id}
              className={`block w-full border-l-4 p-4 text-left transition hover:bg-slate-50 disabled:opacity-60 ${selected === id ? 'border-l-teal-600 bg-teal-50/60' : 'border-l-transparent'}`}>
              <div className="flex justify-between gap-3"><span className="text-sm font-semibold">{kind === 'meta' ? `Case #${m.id} · •••• ${m.phone_last4 || m.phone_e164.slice(-4)}` : r.full_name || `Patient #${r.patient_id}`}</span>
                {kind === 'revenue' && <span className="whitespace-nowrap text-sm font-bold">{money(r.net_bill)}</span>}</div>
              <p className="mt-1 text-xs leading-5 text-slate-600">{humanize(row.reason)}</p>
              <p className="mt-2 text-xs text-slate-500">{kind === 'meta' ? `${humanize(m.review_status)} · ${date(m.first_seen_at)}` : `${r.hn} · ${r.invoice_count} invoices · ${date(r.first_invoice_date)}`}</p>
            </button>
          })}
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
          <button className={button} disabled={page === 0 || loadingQueue} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span>Page {page + 1} of {Math.max(1, Math.ceil((queue?.total || 0) / 25))}</span>
          <button className={button} disabled={(page + 1) * 25 >= (queue?.total || 0) || loadingQueue} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      </section>
      <section aria-label="Case evidence and decision" className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        {!detail ? <div className="py-20 text-center"><p className="text-3xl text-teal-700" aria-hidden="true">◎</p><h2 className="mt-4 text-lg font-semibold">{loadingDetail ? 'Loading original evidence…' : 'Select a case to review'}</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">Compare original evidence with the hospital record, then record the decision and its verification basis.</p></div> : <>
          <div className="flex flex-wrap justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-teal-700">{kind === 'meta' ? 'Identity verification' : 'Acquisition verification'}</p>
              <h2 tabIndex={-1} ref={detailHeading} className="mt-1 text-xl font-bold outline-none">{kind === 'meta' ? `Meta case #${selected}` : detail.patient?.full_name}</h2>
              <p className="mt-1 text-sm text-slate-500">{kind === 'meta' ? `${detail.candidate?.phone_e164} · ${humanize(detail.case?.review_status || '')}` : `${detail.patient?.hn} · ${detail.patient?.phone || 'No phone recorded'}`}</p></div>
            <button className={`${button} self-start`} disabled={saving} onClick={() => selected && openCase(selected)}>Reload evidence</button>
          </div>
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600">{reasonDescriptions[detail.assessment?.reason || revenue[0]?.reason || ''] || 'Review the original evidence and document why the identity or source is valid. A phone match or imported timestamp alone is insufficient.'}</p>
          {kind === 'revenue' && pipeline?.snapshotRevision !== detail.pipeline.snapshotRevision && <p role="status" className="mt-3 rounded-lg bg-teal-50 p-3 text-sm text-teal-900">A newer validated revenue publication is available. Reload this case for its current figures; your unsaved notes stay here until you reload.</p>}
          {detail.case?.review_notes && <div className="mt-3 rounded-lg border border-slate-200 p-3 text-xs leading-5 text-slate-600"><p className="font-semibold">Existing review notes{detail.case.selected_crm_lead_id ? ` · Lead #${detail.case.selected_crm_lead_id}` : ''}</p><p className="mt-1 whitespace-pre-wrap">{detail.case.review_notes}</p></div>}
          {kind === 'meta' ? <>
            {(detail.assessment?.proxy_language_present || detail.assessment?.contact_phone_conflict) && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{detail.assessment.proxy_language_present ? 'Possible relative or caregiver relationship. ' : ''}{detail.assessment.contact_phone_conflict ? 'Contact phone conflict. ' : ''}Explain how these conflicts were resolved before confirming.</p>}
            <details open className="mt-5 border-b border-slate-200 pb-5">
              <summary className="cursor-pointer text-sm font-semibold">Original messages ({detail.messages?.length} of {detail.messageCount})</summary>
              <div className="mt-3 max-h-80 space-y-3 overflow-auto pr-1">
                {detail.messages?.map(m => <article key={m.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500"><time>{date(m.received_at)}</time><span className={`rounded-full px-2 py-0.5 font-semibold ${m.native_inbound ? 'bg-teal-50 text-teal-800' : 'bg-amber-50 text-amber-900'}`}>{m.native_inbound ? 'Original inbound verified' : 'Inbound direction unverified'}</span>{m.candidate_evidence && <span>Phone extraction evidence</span>}</div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{m.message_text || '(No text content)'}</p><p className="mt-2 break-all font-mono text-[10px] text-slate-400">Message {m.id}</p>
                </article>)}
                {!detail.messages?.length && <p className="text-sm text-slate-500">No source messages are available. Keep the case open unless independent verification is documented.</p>}
              </div>
              {(detail.messages?.length || 0) < (detail.messageCount || 0) && <button onClick={moreRecords} className={`${button} mt-3`} disabled={loadingDetail}>Load more messages</button>}
            </details>
            <details className="mt-4 border-b border-slate-200 pb-4"><summary className="cursor-pointer text-sm font-semibold">Original campaign touches ({detail.touches?.length})</summary>
              <div className="mt-3 space-y-2">{detail.touches?.map(t => <div key={t.id} className="rounded bg-slate-50 p-3 text-xs leading-5"><strong>{t.campaign_name || 'Campaign not recorded'}</strong><p>{date(t.touched_at)} · {humanize(t.touch_type)} · Ad {t.ad_id || 'unknown'}</p></div>)}</div>
              <p className="mt-2 text-xs text-slate-500">Identity verification uses original touch dates. It does not backdate acquisition to the review date.</p>
            </details>
          </> : <>
            <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Unattributed net bill</p><p className="mt-1 text-lg font-bold">{money(revenue.reduce((n, r) => n + Number(r.net_bill), 0))}</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">First clinical invoice</p><p className="mt-1 text-sm font-semibold">{date(firstClinical)}</p></div></div>
            <details open className="mt-5 border-b border-slate-200 pb-4"><summary className="cursor-pointer text-sm font-semibold">Current acquisition evidence ({detail.evidence?.length})</summary>
              <div className="mt-3 space-y-2">{detail.evidence?.map((e, i) => <div key={`${e.evidence_table}:${e.evidence_id}:${i}`} className="rounded-lg border border-slate-200 p-3 text-xs leading-5"><p className="font-semibold">{humanize(e.source || 'unknown')} · {date(e.event_date)}</p><p>{e.authenticated ? 'Identity authenticated' : 'Identity unverified'}{e.identity_conflict ? ' · Identity conflict' : ''}{e.outbound ? ' · Outbound only' : ''}</p><p className="mt-1 break-all font-mono text-[11px] text-slate-500">{e.evidence_table} / {e.evidence_id}</p><p className="text-slate-500">{humanize(e.date_basis)}</p></div>)}</div>
              {!detail.evidence?.length && <p className="mt-3 text-sm text-slate-500">No acquisition evidence recorded.</p>}
            </details>
            <details className="mt-4 border-b border-slate-200 pb-4"><summary className="cursor-pointer text-sm font-semibold">Original source records ({detail.originalRecords?.total || 0})</summary>
              <div className="mt-3 max-h-96 space-y-3 overflow-auto">{detail.originalRecords?.items.map(r => <article key={`${r.evidence_table}:${r.evidence_id}`} className="rounded-lg border border-slate-200 p-3"><p className="break-all font-mono text-[11px] font-semibold text-teal-800">{r.evidence_table} / {r.evidence_id}</p><dl className="mt-2 space-y-2">{Object.entries(r.fields).map(([k,v]) => <div key={k}><dt className="text-[11px] font-semibold text-slate-500">{k}</dt><dd className="whitespace-pre-wrap break-words text-xs leading-5">{String(v)}</dd></div>)}</dl></article>)}</div>
              {!!detail.originalRecords && detail.originalRecords.items.length < detail.originalRecords.total && <button type="button" className={`${button} mt-3`} disabled={loadingDetail} onClick={moreRecords}>Load more source records</button>}
              {!detail.originalRecords?.total && <p className="mt-3 text-xs text-slate-500">No linked original source records are available. Document independently verified evidence in the decision.</p>}
            </details>
            <details className="mt-4 border-b border-slate-200 pb-4"><summary className="cursor-pointer text-sm font-semibold">Invoice history ({detail.invoiceCount})</summary><div className="mt-3 max-h-64 overflow-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b text-slate-500"><th className="py-2">Invoice</th><th>Date</th><th className="text-right">Net bill</th></tr></thead><tbody>{detail.invoices?.map(i => <tr className="border-b border-slate-100" key={i.id}><td className="py-2 pr-2">{i.invoice_no}</td><td className="pr-2">{date(i.invoice_date)}</td><td className="text-right">{money(i.net_bill)}</td></tr>)}</tbody></table></div>{(detail.invoices?.length || 0) < (detail.invoiceCount || 0) && <button className={`${button} mt-3`} disabled={loadingDetail} onClick={moreRecords}>Load more invoices</button>}</details>
          </>}
          <form onSubmit={e => { e.preventDefault(); void save() }} className="mt-6">
            <h3 className="font-semibold">Record a review decision</h3>
            {!queue?.writesEnabled && <p className="mt-2 text-sm text-amber-800">Corrections are paused by the ingestion configuration.</p>}
            <fieldset disabled={saving || !!pending || !queue?.writesEnabled} className="mt-4 space-y-4 disabled:opacity-70">
              <label className="block text-sm font-medium">Decision<select className={input} value={action} onChange={e => { setAction(e.target.value); setAttested(false) }}>
                <option value="needs_review">Keep open — more evidence needed</option>
                {kind === 'meta' ? <><option value="confirm">Confirm same patient</option><option value="duplicate">Resolve duplicate CRM records to one patient</option><option value="reject">Reject identity match</option><option value="no_match">Reviewed — no CRM match</option><option value="reopen">Reopen / retract prior identity confirmation</option></> : <><option value="verify_source">Record verified acquisition source</option>{detail.sourceCorrection?.active && <option value="retract_source">Retract current source correction</option>}</>}
              </select></label>
              {kind === 'meta' && verification && <div className="space-y-3 rounded-lg border border-teal-200 bg-teal-50/40 p-4">
                <label className="block text-sm font-medium">Find an existing CRM lead<span className="flex gap-2"><input className={input} value={leadQuery} onChange={e => setLeadQuery(e.target.value)} maxLength={100} placeholder="Patient name, HN, phone or lead ID" /><button type="button" className={`${button} mt-1`} disabled={searchingLeads || leadQuery.trim().length < 2} onClick={searchLeads}>{searchingLeads ? 'Searching…' : 'Find'}</button></span></label>
                <div className="max-h-56 space-y-2 overflow-auto">{matches.map(l => <label key={l.id} className={`flex cursor-pointer gap-3 rounded-lg border bg-white p-3 text-xs ${lead?.id === l.id ? 'border-teal-600' : 'border-slate-200'}`}><input type="radio" name="verified-lead" className="mt-1 accent-teal-700" checked={lead?.id === l.id} disabled={!l.patient_id || !l.hn} onChange={() => { setLead(l); setVerifiedHn(''); setAttested(false) }} /><span><strong className="text-sm">{l.full_name || l.lead_name}</strong><br />Lead #{l.id} · {l.hn || 'No canonical hospital number'}<br />{l.phone || 'No phone'} · {l.source || 'Source unknown'}{!l.patient_id && <span className="block text-amber-800">Link this lead to a verified patient in the CRM first.</span>}</span></label>)}</div>
                <p className="text-xs leading-5 text-slate-600">Duplicate resolution retains all original records. A relative’s phone can be shared; verify the actual patient. <Link href="/" className="font-semibold text-teal-800 underline">Open lead intake ↗</Link></p>
              </div>}
              {kind === 'revenue' && action === 'verify_source' && <div className="space-y-4 rounded-lg border border-teal-200 bg-teal-50/40 p-4">
                <label className="block text-sm font-medium">Verified original acquisition source<select className={input} value={source} onChange={e => setSource(e.target.value)}><option value="facebook">Facebook / Meta</option><option value="google">Google</option><option value="referral">Referral / word of mouth</option><option value="doctor recommendation">Doctor recommendation</option><option value="organic_direct">Organic / direct walk-in</option></select></label>
                <label className="block text-sm font-medium">Original acquisition date<input type="date" className={input} value={eventDate} onChange={e => setEventDate(e.target.value)} min="2000-01-01" required /></label>
                <p className="text-xs leading-5 text-slate-600">Use the date of the verified acquisition event. This is separate from today’s review date. Campaign or ad attribution is not invented from a source label.</p>
                {firstClinical && eventDate > firstClinical && <p role="status" className="rounded-lg bg-amber-100 p-3 text-xs leading-5 text-amber-900">This source date is after the first clinical invoice. The pipeline will retain the late-source exclusion; it will not automatically attribute this revenue.</p>}
                {!!detail.originalEvidence?.length && <details><summary className="cursor-pointer text-xs font-semibold">Replace incorrect source evidence (optional)</summary><p className="mt-2 text-xs leading-5 text-slate-600">Select only records verified to be incorrect. They remain in the original tables and audit history. Retracting this correction restores them to the attribution rules.</p><div className="mt-2 max-h-52 space-y-2 overflow-auto">{detail.originalEvidence.map((e, i) => <label key={`${e.evidence_table}:${e.evidence_id}:${i}`} className="flex gap-2 rounded bg-white p-2 text-xs"><input type="checkbox" className="accent-teal-700" checked={excluded.some(x => x.table === e.evidence_table && x.id === e.evidence_id)} onChange={ev => setExcluded(old => ev.target.checked ? [...old, { table: e.evidence_table, id: e.evidence_id }] : old.filter(x => x.table !== e.evidence_table || x.id !== e.evidence_id))} /><span>{humanize(e.source || 'unknown')} · {date(e.event_date)}<br /><span className="break-all text-slate-500">{e.evidence_table} / {e.evidence_id}</span></span></label>)}</div></details>}
              </div>}
              {verification && <>
                <label className="block text-sm font-medium">Enter the verified hospital number<input className={input} value={verifiedHn} maxLength={100} onChange={e => setVerifiedHn(e.target.value)} placeholder="Hospital number checked against the patient record" required /></label>
                <label className="block text-sm font-medium">Supporting evidence reference<textarea className={input} rows={2} value={reference} onChange={e => setReference(e.target.value)} maxLength={1000} placeholder="Original message ID, call log ID, registration record or documented verification reference" required /></label>
              </>}
              <label className="block text-sm font-medium">Verification notes<textarea className={input} value={reason} onChange={e => setReason(e.target.value)} rows={3} minLength={20} maxLength={2000} required placeholder="Explain what was checked, what conflicts were resolved, and why this decision is justified." /><span className="mt-1 block text-xs text-slate-500">20–2,000 characters. Include how any shared phone, proxy relationship or incorrect original record was resolved.</span></label>
              {verification && <label className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 text-xs leading-6"><input className="mt-1.5 accent-teal-700" type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} required /><span>{kind === 'meta' ? 'I independently verified this conversation belongs to the selected patient and resolved any proxy or shared-phone conflicts. A phone match alone is insufficient.' : 'I verified the patient, acquisition source and original event date against the referenced evidence. This is an acquisition event, not an outbound follow-up or an import timestamp.'}</span></label>}
            </fieldset>
            {pending && <p className="mt-4 text-xs leading-5 text-amber-800">A request is awaiting confirmation. Retry sends the identical decision safely. Reload evidence to inspect its recorded history before changing the decision.</p>}
            <button type="submit" disabled={saving || !queue?.writesEnabled} className="mt-5 w-full rounded-lg bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">{saving ? 'Saving decision…' : pending ? 'Retry the same decision' : 'Save decision & queue reconciliation'}</button>
          </form>
          <details open className="mt-6 border-t border-slate-200 pt-5"><summary className="cursor-pointer text-sm font-semibold">Audit trail ({detail.history.length})</summary>
            <div className="mt-3 space-y-3">{detail.history.map(h => <article key={h.request_id} className="rounded-lg bg-slate-50 p-3 text-xs leading-5"><div className="flex flex-wrap justify-between gap-2"><strong>{humanize(h.action)}</strong><span className={pipeline?.current && Number(pipeline.publishedRevision) >= h.requested_revision ? 'font-semibold text-teal-800' : 'font-semibold text-amber-800'}>{pipeline?.current && Number(pipeline.publishedRevision) >= h.requested_revision ? 'Reconciled downstream' : 'Awaiting reconciliation'}</span></div><p className="mt-1 whitespace-pre-wrap">{h.reason}</p>{h.evidence.reference && <p className="mt-1 break-words text-slate-500">Evidence: {h.evidence.reference}</p>}<p className="mt-1 text-slate-500">{date(h.created_at)} · Revision {h.requested_revision}</p><p className="break-all font-mono text-[10px] text-slate-400">Administrator {h.actor_id} · Request {h.request_id}</p></article>)}</div>
            {!detail.history.length && <p className="mt-3 text-xs text-slate-500">No decisions have been recorded through this review page yet. Prior review status remains visible above.</p>}
          </details>
        </>}
      </section>
    </div>
  </main>
}

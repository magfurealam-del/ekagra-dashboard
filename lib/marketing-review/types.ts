export type ReviewKind = 'meta' | 'revenue'
export type Pipeline = {
  sourceRevision: number; publishedRevision: number | null; stage: string | null
  current: boolean; inWindow: boolean; hasBatch: boolean; failedJobs: number
  snapshotAt: string | null; snapshotRevision: number | null
}
export type LeadMatch = {
  id: number; patient_id: number | null; lead_name: string | null; phone: string | null
  source: string | null; hn: string | null; full_name: string | null; version: string
}
export type MetaRow = {
  id: number; candidate_id: number; phone_e164: string; phone_last4: string
  review_status: string; selected_crm_lead_id: number | null; reason: string
  first_seen_at: string; last_seen_at: string; direction_class: string; meta_campaign_name: string | null
}
export type RevenueRow = {
  patient_id: number; reason: string; invoice_count: number; net_bill: number
  hn: string; full_name: string; first_invoice_date: string | null; last_invoice_date: string | null
  first_clinical_date: string | null; source: string | null; source_date: string | null
}
export type ReviewQueue = {
  items: Array<MetaRow | RevenueRow>; total: number; open?: number; patients?: number; netBill?: number
  reasons: Record<string, number>; pipeline: Pipeline; writesEnabled: boolean
}
export type Evidence = {
  patient_id: number; source: string | null; event_date: string | null; evidence_table: string; evidence_id: string
  authenticated: boolean; identity_conflict: boolean; outbound: boolean; authentication_method: string
  date_basis: string; priority: number; campaign_name: string | null; ad_id: string | null
}
export type ReviewHistory = {
  request_id: string; actor_id: string; action: string; reason: string; evidence: { reference?: string }
  requested_revision: number; created_at: string; reconciled: boolean
}
export type ReviewDetail = {
  version: string; pipeline: Pipeline; history: ReviewHistory[]
  case?: { id: number; review_status: string; selected_crm_lead_id: number | null; review_notes: string | null }
  candidate?: { id: number; phone_e164: string; direction_class: string; psid: string; page_id: string }
  assessment?: { reason?: string; proxy_language_present?: boolean; contact_phone_conflict?: boolean }
  contact?: { id: number; phone: string | null; convertedLeadId: number | null } | null
  messages?: Array<{ id: string; message_text: string | null; received_at: string; native_inbound: boolean; candidate_evidence: boolean }>
  messageCount?: number; matches?: LeadMatch[]
  touches?: Array<{ id: number; touched_at: string; touch_type: string; ad_id: string | null; campaign_name: string | null }>
  patient?: { id: number; hn: string; full_name: string; phone: string | null }
  revenue?: RevenueRow[]; evidence?: Evidence[]; originalEvidence?: Evidence[]
  originalRecords?: { items: Array<{ evidence_table: string; evidence_id: string; fields: Record<string, string | number> }>; total: number }
  sourceCorrection?: { id: number; active: boolean; source: string | null; event_date: string | null; evidence_reference: string; excluded_evidence: Array<{ table: string; id: string }> } | null
  invoices?: Array<{ id: number; invoice_no: string; invoice_date: string; net_bill: number; reconciliation_status: string }>
  invoiceCount?: number
}
export type CorrectionPayload = {
  action: string; reason: string; evidenceReference?: string; attested?: boolean
  leadId?: number; leadVersion?: string; verifiedHn?: string; source?: string; eventDate?: string
  excludedEvidence?: Array<{ table: string; id: string }>
}

export function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())
}
export function pipelineLabel(p: Pipeline): string {
  if (p.current) return 'All downstream tables reconciled'
  if (!p.hasBatch) return 'Waiting for the first accepted MIS import'
  if (p.failedJobs > 0) return 'Reconciliation blocked by an import failure'
  if (!p.inWindow) return 'Queued for the next overnight processing window'
  return `Reconciliation in progress · ${humanize(p.stage || 'queued')}`
}

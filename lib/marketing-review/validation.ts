import type { CorrectionPayload, ReviewKind } from './types.ts'

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function positiveId(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null
}
export function validateCorrection(kind: ReviewKind, value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'A correction is required.'
  const p = value as CorrectionPayload
  const actions = kind === 'meta' ? ['confirm','duplicate','reject','no_match','needs_review','reopen'] : ['verify_source','retract_source','needs_review']
  if (!actions.includes(p.action)) return 'Choose a valid review action.'
  if (typeof p.reason !== 'string' || p.reason.trim().length < 20 || p.reason.length > 2000) return 'Explain the verification in 20–2,000 characters.'
  if (p.evidenceReference !== undefined && (typeof p.evidenceReference !== 'string' || p.evidenceReference.length > 1000)) return 'Evidence reference must be at most 1,000 characters.'
  if (['confirm','duplicate','verify_source'].includes(p.action)) {
    if (p.attested !== true || typeof p.evidenceReference !== 'string' || p.evidenceReference.trim().length < 10) return 'Confirm verification and provide a supporting evidence reference.'
    if (typeof p.verifiedHn !== 'string' || !p.verifiedHn.trim() || p.verifiedHn.length > 100) return 'Enter the verified hospital number.'
  }
  if (['confirm','duplicate'].includes(p.action) && (!positiveId(p.leadId) || typeof p.leadVersion !== 'string' || !/^[a-f0-9]{32}$/.test(p.leadVersion))) return 'Select an existing CRM lead linked to a patient.'
  if (p.action === 'verify_source') {
    if (!['facebook','google','referral','doctor recommendation','organic_direct'].includes(p.source || '')) return 'Choose a supported acquisition source.'
    if (typeof p.eventDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.eventDate) || !Number.isFinite(Date.parse(p.eventDate)) || new Date(p.eventDate).toISOString().slice(0,10) !== p.eventDate) return 'Enter a valid original acquisition date.'
    if (p.excludedEvidence !== undefined && (!Array.isArray(p.excludedEvidence) || p.excludedEvidence.length > 20 || p.excludedEvidence.some(e => !e || typeof e.table !== 'string' || typeof e.id !== 'string' || e.table.length > 100 || e.id.length > 100))) return 'Select at most 20 evidence records to replace.'
  }
  return null
}

export type OutcomeCode =
  | 'reached' | 'not_reached' | 'busy'
  | 'booked_appointment' | 'already_visited' | 'not_interested'

export type OutcomeDef = {
  code: OutcomeCode
  label: string
  resolve: boolean
  tone: string
}

export const OUTCOMES: OutcomeDef[] = [
  { code: 'reached',            label: 'Reached',            resolve: false, tone: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  { code: 'not_reached',        label: 'Not Reached',        resolve: false, tone: 'border-slate-300 bg-slate-50 text-slate-600' },
  { code: 'busy',               label: 'Busy',               resolve: false, tone: 'border-amber-300 bg-amber-50 text-amber-700' },
  { code: 'booked_appointment', label: 'Booked Appointment', resolve: true,  tone: 'border-teal-400 bg-teal-50 text-teal-700' },
  { code: 'already_visited',    label: 'Already Visited',    resolve: true,  tone: 'border-slate-300 bg-slate-50 text-slate-600' },
  { code: 'not_interested',     label: 'Not Interested',     resolve: true,  tone: 'border-slate-300 bg-slate-50 text-slate-600' },
]

// ─── Priority bucket metadata ──────────────────────────────────────────────
// 15 explicit buckets in rank order. Rank is the sort key for the queue;
// lower = higher priority.
export type CategoryKey =
  | 'no_show_7' | 'no_show_14' | 'no_show_28'
  | 'surgery_no_show'
  | 'healing_overdue_4w' | 'healing_overdue_8w' | 'healing_overdue_old'
  | 'wound_no_appt_7' | 'wound_no_appt_14' | 'wound_no_appt_28' | 'wound_no_appt_old'
  | 'screening_no_appt_7' | 'screening_no_appt_14' | 'screening_no_appt_28' | 'screening_no_appt_old'
  | 'general_no_appt'

export const CATEGORY_LABEL: Record<string, string> = {
  no_show_7:            'No-show — last 7 days',
  no_show_14:           'No-show — 8–14 days ago',
  no_show_28:           'No-show — 15–28 days ago',
  surgery_no_show:      'Surgery scheduled — no-show',
  healing_overdue_4w:   'Not healed — 2–4 weeks overdue',
  healing_overdue_8w:   'Not healed — 4–8 weeks overdue',
  healing_overdue_old:  'Not healed — 8+ weeks overdue',
  wound_no_appt_7:      'Wound Care lead — called this week',
  wound_no_appt_14:     'Wound Care lead — called 8–14 days ago',
  wound_no_appt_28:     'Wound Care lead — called 15–28 days ago',
  wound_no_appt_old:    'Wound Care lead — called 28+ days ago',
  screening_no_appt_7:  'Screening lead — called this week',
  screening_no_appt_14: 'Screening lead — called 8–14 days ago',
  screening_no_appt_28: 'Screening lead — called 15–28 days ago',
  screening_no_appt_old:'Screening lead — called 28+ days ago',
  general_no_appt:     'General lead — no appointment yet',
}

export const CATEGORY_BADGE_LABEL: Record<string, string> = {
  no_show_7:            'No-show (7d)',
  no_show_14:           'No-show (14d)',
  no_show_28:           'No-show (28d)',
  surgery_no_show:      'Surgery missed',
  healing_overdue_4w:   'Healing 2–4w',
  healing_overdue_8w:   'Healing 4–8w',
  healing_overdue_old:  'Healing 8w+',
  wound_no_appt_7:      'Wound (7d)',
  wound_no_appt_14:     'Wound (14d)',
  wound_no_appt_28:     'Wound (28d)',
  wound_no_appt_old:    'Wound (28d+)',
  screening_no_appt_7:  'Screening (7d)',
  screening_no_appt_14: 'Screening (14d)',
  screening_no_appt_28: 'Screening (28d)',
  screening_no_appt_old:'Screening (28d+)',
  general_no_appt:     'General (no appointment)',
}

// ─── Call type: lead generation vs. patient recovery/no-show ──────────────
// Wound/screening leads never had an appointment — the agent is chasing a
// new booking. Everything else (no-show, surgery no-show, healing overdue)
// is about recovering a patient who already has a relationship with us.
export type CallType = 'lead_gen' | 'patient_recovery'

export const CALL_TYPE_FOR_CATEGORY: Record<string, CallType> = {
  no_show_7: 'patient_recovery',
  no_show_14: 'patient_recovery',
  no_show_28: 'patient_recovery',
  surgery_no_show: 'patient_recovery',
  healing_overdue_4w: 'patient_recovery',
  healing_overdue_8w: 'patient_recovery',
  healing_overdue_old: 'patient_recovery',
  wound_no_appt_7: 'lead_gen',
  wound_no_appt_14: 'lead_gen',
  wound_no_appt_28: 'lead_gen',
  wound_no_appt_old: 'lead_gen',
  screening_no_appt_7: 'lead_gen',
  screening_no_appt_14: 'lead_gen',
  screening_no_appt_28: 'lead_gen',
  screening_no_appt_old: 'lead_gen',
  general_no_appt: 'lead_gen',
}

export const CALL_TYPE_LABEL: Record<CallType, string> = {
  lead_gen: 'Lead Gen',
  patient_recovery: 'Patient Recovery',
}

export const CALL_TYPE_TONE: Record<CallType, string> = {
  lead_gen: 'bg-violet-100 text-violet-700',
  patient_recovery: 'bg-cyan-100 text-cyan-700',
}

export function callTypeForCategory(category: string): CallType {
  return CALL_TYPE_FOR_CATEGORY[category] ?? 'patient_recovery'
}

export const CATEGORY_BADGE_TONE: Record<string, string> = {
  no_show_7:            'bg-rose-100 text-rose-700',
  no_show_14:           'bg-amber-100 text-amber-700',
  no_show_28:           'bg-amber-50 text-amber-600',
  surgery_no_show:      'bg-rose-100 text-rose-700',
  healing_overdue_4w:   'bg-orange-100 text-orange-700',
  healing_overdue_8w:   'bg-orange-50 text-orange-600',
  healing_overdue_old:  'bg-slate-100 text-slate-500',
  wound_no_appt_7:      'bg-sky-100 text-sky-700',
  wound_no_appt_14:     'bg-sky-50 text-sky-600',
  wound_no_appt_28:     'bg-sky-50 text-sky-500',
  wound_no_appt_old:    'bg-slate-100 text-slate-500',
  screening_no_appt_7:  'bg-indigo-100 text-indigo-700',
  screening_no_appt_14: 'bg-indigo-50 text-indigo-600',
  screening_no_appt_28: 'bg-indigo-50 text-indigo-500',
  screening_no_appt_old:'bg-slate-100 text-slate-500',
  general_no_appt:     'bg-violet-100 text-violet-700',
}

// ─── Quick-filter chips ────────────────────────────────────────────────────
// Each filter maps to one or more categories. `undefined` categories = show all.
export const QUICK_FILTERS: { key: string; label: string; categories?: string[] }[] = [
  { key: 'all',           label: 'All' },
  { key: 'overdue',       label: 'Overdue (No-show 7d+)', categories: ['no_show_14','no_show_28'] },
  { key: 'no_show_7',     label: 'No-show 7d',   categories: ['no_show_7'] },
  { key: 'no_show_14',    label: 'No-show 14d',  categories: ['no_show_14'] },
  { key: 'no_show_28',    label: 'No-show 28d',  categories: ['no_show_28'] },
  { key: 'surgery',       label: 'Surgery',      categories: ['surgery_no_show'] },
  { key: 'healing',       label: 'Healing',      categories: ['healing_overdue_4w','healing_overdue_8w','healing_overdue_old'] },
  { key: 'wound',         label: 'Wound',        categories: ['wound_no_appt_7','wound_no_appt_14','wound_no_appt_28','wound_no_appt_old'] },
  { key: 'screening',     label: 'Screening',    categories: ['screening_no_appt_7','screening_no_appt_14','screening_no_appt_28','screening_no_appt_old'] },
  { key: 'general',       label: 'General',      categories: ['general_no_appt'] },
  { key: 'high_priority', label: 'High Priority',categories: ['no_show_7','no_show_14','surgery_no_show'] },
]

export function priorityBadges(row: any): { label: string; tone: string }[] {
  const badges: { label: string; tone: string }[] = []
  const callType = callTypeForCategory(row.category)
  badges.push({ label: CALL_TYPE_LABEL[callType], tone: CALL_TYPE_TONE[callType] })
  badges.push({
    label: CATEGORY_BADGE_LABEL[row.category] ?? row.category,
    tone:  CATEGORY_BADGE_TONE[row.category]  ?? 'bg-slate-100 text-slate-500',
  })
  if (row.max_followups > 1) {
    badges.push({ label: `Follow-up ${row.followup_number}/${row.max_followups}`, tone: 'bg-slate-100 text-slate-500' })
  }
  if (row.category_rank <= 4) {
    badges.push({ label: 'High Priority', tone: 'bg-red-100 text-red-700' })
  }
  return badges
}

export const BRANCHES = ['Ekagra Health, Dhanmondi']

// ─── Helpers ───────────────────────────────────────────────────────────────
export function formatQueueDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function daysAgoLabel(iso: string | null): string {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

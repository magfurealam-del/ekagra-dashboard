export type OutcomeCode =
  | 'reached'
  | 'not_reached'
  | 'busy'
  | 'switched_off'
  | 'wrong_number'
  | 'booked_appointment'
  | 'already_visited'
  | 'not_interested'
  | 'call_later'
  | 'do_not_call'

export type OutcomeDef = {
  code: OutcomeCode
  label: string
  resolve: boolean // does this close out the queue entry (no more followups)?
  tone: string
}

export const OUTCOMES: OutcomeDef[] = [
  { code: 'reached', label: 'Reached', resolve: false, tone: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  { code: 'not_reached', label: 'Not Reached', resolve: false, tone: 'border-slate-300 bg-slate-50 text-slate-600' },
  { code: 'busy', label: 'Busy', resolve: false, tone: 'border-amber-300 bg-amber-50 text-amber-700' },
  { code: 'switched_off', label: 'Switched Off', resolve: false, tone: 'border-slate-300 bg-slate-50 text-slate-600' },
  { code: 'wrong_number', label: 'Wrong Number', resolve: true, tone: 'border-rose-300 bg-rose-50 text-rose-700' },
  { code: 'booked_appointment', label: 'Booked Appointment', resolve: true, tone: 'border-teal-400 bg-teal-50 text-teal-700' },
  { code: 'already_visited', label: 'Already Visited', resolve: true, tone: 'border-slate-300 bg-slate-50 text-slate-600' },
  { code: 'not_interested', label: 'Not Interested', resolve: true, tone: 'border-slate-300 bg-slate-50 text-slate-600' },
  { code: 'call_later', label: 'Call Later', resolve: false, tone: 'border-sky-300 bg-sky-50 text-sky-700' },
  { code: 'do_not_call', label: 'Do Not Call', resolve: true, tone: 'border-rose-300 bg-rose-50 text-rose-700' },
]

// Priority queue categories, in business-priority order (rank = sort key).
// No-shows are split by recency so the freshest, most-recoverable ones surface
// first; healing follow-ups are split by how overdue they are.
export const CATEGORY_LABEL: Record<string, string> = {
  no_show_7: 'No-show — last 7 days',
  no_show_14: 'No-show — 8–14 days',
  no_show_28: 'No-show — 15–28 days',
  surgery_no_show: 'Surgery scheduled — no-show',
  healing_overdue_4w: 'Not healed — 2–4 weeks overdue',
  healing_overdue_8w: 'Not healed — 4–8 weeks overdue',
  healing_overdue_old: 'Not healed — 8+ weeks overdue',
  wound_no_appt: 'Wound Care lead — no appointment',
  screening_no_appt: 'Screening lead — no appointment',
}

export const CATEGORY_BADGE_LABEL: Record<string, string> = {
  no_show_7: 'No-show (7d)',
  no_show_14: 'No-show (14d)',
  no_show_28: 'No-show (28d)',
  surgery_no_show: 'Surgery missed',
  healing_overdue_4w: 'Healing 2-4w',
  healing_overdue_8w: 'Healing 4-8w',
  healing_overdue_old: 'Healing 8w+',
  wound_no_appt: 'Wound lead',
  screening_no_appt: 'Screening lead',
}

export const CATEGORY_BADGE_TONE: Record<string, string> = {
  no_show_7: 'bg-rose-100 text-rose-700',
  no_show_14: 'bg-amber-100 text-amber-700',
  no_show_28: 'bg-amber-50 text-amber-600',
  surgery_no_show: 'bg-rose-100 text-rose-700',
  healing_overdue_4w: 'bg-orange-100 text-orange-700',
  healing_overdue_8w: 'bg-orange-50 text-orange-600',
  healing_overdue_old: 'bg-slate-100 text-slate-600',
  wound_no_appt: 'bg-sky-100 text-sky-700',
  screening_no_appt: 'bg-indigo-100 text-indigo-700',
}

// Quick-filter chips shown above the queue. Each maps to one or more categories.
export const QUICK_FILTERS: { key: string; label: string; categories?: string[] }[] = [
  { key: 'all', label: 'All' },
  { key: 'no_show_7', label: 'No-show 7d', categories: ['no_show_7'] },
  { key: 'no_show_14', label: 'No-show 14d', categories: ['no_show_14'] },
  { key: 'no_show_28', label: 'No-show 28d', categories: ['no_show_28'] },
  { key: 'surgery_no_show', label: 'Surgery', categories: ['surgery_no_show'] },
  { key: 'healing', label: 'Healing Follow-up', categories: ['healing_overdue_4w', 'healing_overdue_8w', 'healing_overdue_old'] },
  { key: 'wound_no_appt', label: 'Wound Lead', categories: ['wound_no_appt'] },
  { key: 'screening_no_appt', label: 'Screening Lead', categories: ['screening_no_appt'] },
  { key: 'high_priority', label: 'High Priority', categories: ['no_show_7', 'no_show_14', 'surgery_no_show'] },
]

export function priorityLabel(rank: number) {
  return `P${rank}`
}

export function priorityBadges(row: any): { label: string; tone: string }[] {
  const badges: { label: string; tone: string }[] = []
  const badgeLabel = CATEGORY_BADGE_LABEL[row.category] ?? row.category
  const tone = CATEGORY_BADGE_TONE[row.category] ?? 'bg-slate-100 text-slate-600'
  badges.push({ label: badgeLabel, tone })
  if (row.max_followups > 1) {
    badges.push({
      label: `Follow-up ${row.followup_number}/${row.max_followups}`,
      tone: 'bg-slate-100 text-slate-500',
    })
  }
  if (row.category_rank <= 4) {
    badges.push({ label: 'High Priority', tone: 'bg-red-100 text-red-700' })
  }
  return badges
}

export const BRANCHES = ['Ekagra Health, Dhanmondi']

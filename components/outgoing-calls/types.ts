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

export const CATEGORY_LABEL: Record<string, string> = {
  no_show: 'No-show',
  surgery_no_show: 'Surgery — No-show',
  healing_overdue: 'Healing Follow-up',
  wound_screening_no_appt: 'Wound/Screening Lead',
}

export function priorityLabel(rank: number) {
  return `P${rank}`
}

export function priorityBadges(row: any): { label: string; tone: string }[] {
  const badges: { label: string; tone: string }[] = []
  if (row.category === 'no_show') {
    badges.push({ label: 'No-show', tone: 'bg-rose-100 text-rose-700' })
  } else if (row.category === 'surgery_no_show') {
    badges.push({ label: 'Surgery missed', tone: 'bg-rose-100 text-rose-700' })
  } else if (row.category === 'healing_overdue') {
    badges.push({
      label: `Follow-up ${row.followup_number}/${row.max_followups}`,
      tone: 'bg-orange-100 text-orange-700',
    })
  } else if (row.category === 'wound_screening_no_appt') {
    const isWound = (row.reason || '').toLowerCase().includes('wound')
    badges.push({
      label: isWound ? 'Wound Lead' : 'Screening Lead',
      tone: 'bg-sky-100 text-sky-700',
    })
  }
  if (row.category_rank <= 2) {
    badges.push({ label: 'High Priority', tone: 'bg-red-100 text-red-700' })
  }
  return badges
}

export const BRANCHES = ['Ekagra Health, Dhanmondi']

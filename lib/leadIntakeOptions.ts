// Fixed dropdown lists per the Lead Intake & Appointment spec.
// These are intentionally hardcoded (not dropdown_options-driven) since the
// spec calls for a specific fixed structure for attribution/reporting.

export const SOURCE_CHANNEL_OPTIONS = [
  'Facebook Ad',
  'Facebook Page / Messenger',
  'WhatsApp',
  'Phone / Hotline',
  'Walk-in',
  'Doctor Recommendation',
  'Previous Patient Referral',
  'Other',
]

export const LEAD_BUCKET_OPTIONS = [
  'Wound',
  'Screening',
  'Surgery',
  'General Inquiry',
  'Existing Patient Follow-up',
  'No Appointment Follow-up',
  'No-show Recovery',
  'Other',
]

export const MAIN_CONCERN_OPTIONS = [
  'Diabetic foot wound',
  'Foot pain / burning',
  'Numbness / tingling',
  'Dressing',
  'Screening package',
  'Surgery follow-up',
  'Doctor consultation',
  'Wheelchair / general inquiry',
  'Other',
]

export const URGENCY_OPTIONS = ['Routine', 'Soon', 'Urgent']

export const NEW_OLD_STATUS_OPTIONS = ['New', 'Old', 'Unknown']

export const INTAKE_OUTCOME_OPTIONS: { value: string; label: string }[] = [
  { value: 'appointment_booked', label: 'Appointment Booked' },
  { value: 'no_appointment_yet', label: 'No Appointment Yet' },
  { value: 'call_later', label: 'Call Later' },
  { value: 'not_reached', label: 'Not Reached' },
  { value: 'busy', label: 'Busy' },
  { value: 'switched_off', label: 'Switched Off' },
  { value: 'wrong_number', label: 'Wrong Number' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'general_inquiry', label: 'General Inquiry Only' },
]

export const FOLLOW_UP_PRIORITY_OPTIONS = [
  { value: 'P1', label: 'P1 Urgent' },
  { value: 'P2', label: 'P2 High' },
  { value: 'P3', label: 'P3 Normal' },
  { value: 'P4', label: 'P4 Low' },
]

// Outcomes that require follow_up_priority and create/update a call_queue (crm_follow_ups) row
export const FOLLOWUP_QUEUE_OUTCOMES = ['no_appointment_yet', 'not_reached', 'busy', 'switched_off']
// Outcomes that require a follow-up due date/time
export const CALLBACK_OUTCOMES = ['call_later']
// Outcomes that suppress the lead from the active queue
export const SUPPRESSED_OUTCOMES = ['wrong_number', 'not_interested']

export function defaultPriority(leadBucket: string, urgency: string, outcome: string): string {
  if (leadBucket === 'No-show Recovery') return 'P1'
  if (leadBucket === 'Wound' && urgency === 'Urgent') return 'P1'
  if (leadBucket === 'Wound') return 'P2'
  if (leadBucket === 'Screening') return 'P3'
  if (leadBucket === 'General Inquiry') return 'P4'
  return 'P3'
}

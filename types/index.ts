export interface CallCenterLog {
  id: number
  sheet_tab: string
  log_date: string | null
  serial_no: number | null
  call_center_person: string | null
  patient_name: string | null
  patient_id_raw: string | null
  mobile_raw: string | null
  mobile_normalised: string | null
  mobile_e164: string | null
  location: string | null
  patient_age: string | null
  patient_type: 'new' | 'old' | null
  call_category: string | null
  call_source: string | null
  ad_campaign: string | null
  appointment_status: string | null
  doctor_name_raw: string | null
  doctor_id: number | null
  appointment_datetime: string | null
  appointment_date: string | null
  appointment_time: string | null
  appointment_final_status: string | null
  revenue_to_date: number | null
  comments: string | null
  lead_category: string | null
  internal_lead_category: 'wound' | 'screening' | 'other' | null
  lead_source: string | null
  meta_route: string | null
  priority: string | null
  assigned_agent: string | null
  followup_required: boolean
  followup_count: number
  max_followups: number
  next_followup_date: string | null
  last_followup_date: string | null
  last_call_outcome: string | null
  needs_doctor_callback: boolean
  needs_review: boolean
  data_quality_notes: string | null
  eligible_for_meta_export: boolean
  meta_export_exclusion_reason: string | null
  created_at: string | null
  updated_at: string | null
}

export interface CallbackTask {
  id: string
  created_at: string
  updated_at: string
  lead_id: number | null
  patient_id: number | null
  task_type: 'no_show' | 'followup' | 'doctor_callback' | 'outbound'
  priority_rank: number
  reason: string | null
  patient_name: string | null
  phone: string | null
  lead_category: string | null
  source: string | null
  relevant_date: string | null
  due_at: string | null
  assigned_to: string | null
  status: 'pending' | 'in_progress' | 'completed' | 'closed' | 'cancelled'
  followup_number: number
  max_followups: number
  completed_followups: number
  last_outcome: string | null
  last_called_at: string | null
  next_followup_at: string | null
  closed_reason: string | null
  closed_at: string | null
}

export interface CallInteraction {
  id: string
  created_at: string
  callback_task_id: string | null
  lead_id: number | null
  agent_name: string | null
  followup_number: number | null
  outcome: string | null
  notes: string | null
  call_completed_at: string
  next_followup_at: string | null
}

export interface LookupItem {
  id: string
  label: string
  value: string
  sort_order: number
  is_active: boolean
}

export interface DashboardStats {
  leadsToday: number
  appointmentsToday: number
  noShowsToday: number
  pendingCallbacks: number
  woundNoAppt: number
  screeningNoAppt: number
  totalRevenue: number
  facebookLeads: number
}

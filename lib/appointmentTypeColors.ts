// Consistent color assignment for appointment types across the calendar grid
// and the appointment-type dashboard cards.

const PALETTE = [
  { dot: 'bg-teal-500',    chip: 'bg-teal-100 text-teal-700',    tone: 'text-teal-600' },
  { dot: 'bg-indigo-500',  chip: 'bg-indigo-100 text-indigo-700', tone: 'text-indigo-600' },
  { dot: 'bg-amber-500',   chip: 'bg-amber-100 text-amber-700',   tone: 'text-amber-600' },
  { dot: 'bg-rose-500',    chip: 'bg-rose-100 text-rose-700',     tone: 'text-rose-600' },
  { dot: 'bg-sky-500',     chip: 'bg-sky-100 text-sky-700',       tone: 'text-sky-600' },
  { dot: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-700', tone: 'text-emerald-600' },
  { dot: 'bg-purple-500',  chip: 'bg-purple-100 text-purple-700', tone: 'text-purple-600' },
  { dot: 'bg-orange-500',  chip: 'bg-orange-100 text-orange-700', tone: 'text-orange-600' },
  { dot: 'bg-cyan-500',    chip: 'bg-cyan-100 text-cyan-700',     tone: 'text-cyan-600' },
  { dot: 'bg-lime-500',    chip: 'bg-lime-100 text-lime-700',     tone: 'text-lime-600' },
]

const UNSPECIFIED = { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600', tone: 'text-slate-500' }

// Explicit, stable assignment for the known service types so colors don't
// shift as new types are added elsewhere in the palette order.
const FIXED: Record<string, number> = {
  'Consultation': 0,
  'Doctor Consultation Only': 0,
  'Dressing': 1,
  'Screening': 2,
  'Diabetic Foot Screening': 2,
  'Diabetic Foot Screening Package': 2,
  'Surgery / Procedure': 3,
  'OT / Surgery': 3,
  'Follow-up Visit': 4,
  'Wound Care Assessment': 5,
  'Vacuarc Therapy': 6,
}

export function appointmentTypeColor(type: string) {
  if (!type || type === 'Unspecified') return UNSPECIFIED
  if (type in FIXED) return PALETTE[FIXED[type] % PALETTE.length]
  // Deterministic hash fallback for any other/custom type value.
  let hash = 0
  for (let i = 0; i < type.length; i++) hash = (hash * 31 + type.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

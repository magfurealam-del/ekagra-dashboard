'use client'

export type ViewMode = 'aggregate' | 'patient' | 'doctor'

const TABS: { key: ViewMode; label: string }[] = [
  { key: 'aggregate', label: 'Aggregate' },
  { key: 'patient', label: 'By Patient' },
  { key: 'doctor', label: 'By Doctor' },
]

export default function ViewModeTabs({
  value,
  onChange,
}: {
  value: ViewMode
  onChange: (v: ViewMode) => void
}) {
  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-3 py-1.5 text-sm rounded-[5px] transition-colors ${
            value === t.key
              ? 'bg-white text-teal-700 shadow-sm font-medium'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

'use client'

// Lightweight, dependency-free chart primitives (bars/lists/trend) so the
// admin dashboard doesn't need a charting library — consistent with the
// rest of this app's zero-extra-dependency style.

// Styled hover tooltip (CSS-only, no JS state) — used on every bar/KPI so
// hovering always explains exactly what a value means, not just a plain
// number with no context.
function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="relative group/tip inline-block w-full">
      {children}
      <div className="pointer-events-none absolute z-20 left-1/2 -translate-x-1/2 bottom-full mb-2 w-max max-w-[240px] rounded-md bg-slate-900 text-white text-[11px] leading-snug px-2.5 py-1.5 opacity-0 scale-95 group-hover/tip:opacity-100 group-hover/tip:scale-100 transition-all duration-150 shadow-lg">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
      </div>
    </div>
  )
}

// delta is the % change vs the comparison period, when comparison mode is on
export function KPICard({
  label, value, sub, tone = 'text-slate-800', delta, tooltip,
}: { label: string; value: string | number; sub?: string; tone?: string; delta?: number | null; tooltip?: string }) {
  const card = (
    <div className="bg-white rounded-xl border border-slate-200 p-4 h-full hover:border-slate-300 transition-colors">
      <div className="text-xs text-slate-500 flex items-center gap-1">
        {label}
        {tooltip && <span className="text-slate-300 text-[10px] border border-slate-300 rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">?</span>}
      </div>
      <div className="flex items-baseline gap-1.5">
        <div className={`text-2xl font-bold mt-1 ${tone}`}>{value}</div>
        {delta != null && isFinite(delta) && (
          <span className={`text-xs font-medium ${delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
            {delta > 0 ? '↑' : delta < 0 ? '↓' : '·'}{Math.abs(delta)}%
          </span>
        )}
      </div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
  return tooltip ? <Tooltip text={tooltip}>{card}</Tooltip> : card
}

// Classic conversion funnel: decreasing-width bars with %-of-previous-step labels
export function FunnelChart({ steps }: { steps: { label: string; count: number; hint?: string }[] }) {
  const max = Math.max(1, ...steps.map(s => s.count))
  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const pctOfMax = (s.count / max) * 100
        const pctOfPrev = i === 0 ? null : steps[i - 1].count > 0 ? Math.round((s.count / steps[i - 1].count) * 100) : 0
        const tipText = `${s.label}: ${s.count}${pctOfPrev != null ? ` (${pctOfPrev}% of "${steps[i - 1].label}")` : ''}${s.hint ? ` — ${s.hint}` : ''}`
        return (
          <div key={s.label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-600">{s.label}</span>
              <span className="text-slate-500">
                {s.count}{pctOfPrev != null && <span className="text-slate-400"> · {pctOfPrev}% of prev</span>}
              </span>
            </div>
            <Tooltip text={tipText}>
              <div className="h-6 bg-slate-100 rounded-md overflow-hidden cursor-default">
                <div
                  className="h-full rounded-md bg-gradient-to-r from-teal-500 to-teal-400 flex items-center justify-end pr-2 transition-all"
                  style={{ width: `${Math.max(pctOfMax, 4)}%` }}
                />
              </div>
            </Tooltip>
          </div>
        )
      })}
    </div>
  )
}

const BAR_COLORS = ['bg-teal-500', 'bg-indigo-500', 'bg-amber-500', 'bg-rose-500', 'bg-sky-500', 'bg-emerald-500', 'bg-purple-500', 'bg-orange-500']

export function BarList({
  items, colorFor, unit,
}: {
  items: { label: string; count: number }[]
  colorFor?: (label: string, i: number) => string
  unit?: string
}) {
  const max = Math.max(1, ...items.map(i => i.count))
  const total = items.reduce((s, i) => s + i.count, 0)
  if (items.length === 0) return <p className="text-sm text-slate-400">No data for this period.</p>
  return (
    <div className="space-y-2.5">
      {items.map((item, i) => {
        const pct = total > 0 ? Math.round((item.count / total) * 100) : 0
        const displayCount = unit ? `${unit}${item.count.toLocaleString()}` : item.count.toLocaleString()
        return (
          <div key={item.label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-600 truncate pr-2">{item.label}</span>
              <span className="text-slate-500 whitespace-nowrap">
                {displayCount}{total > 0 ? ` (${pct}%)` : ''}
              </span>
            </div>
            <Tooltip text={`${item.label}: ${displayCount}${total > 0 ? ` — ${pct}% of the ${total.toLocaleString()} shown here` : ''}`}>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden cursor-default">
                <div
                  className={`h-full rounded-full ${colorFor ? colorFor(item.label, i) : BAR_COLORS[i % BAR_COLORS.length]}`}
                  style={{ width: `${(item.count / max) * 100}%` }}
                />
              </div>
            </Tooltip>
          </div>
        )
      })}
    </div>
  )
}

export function TrendChart({ data }: { data: { date: string; leads: number; appointments: number }[] }) {
  if (data.length === 0) return <p className="text-sm text-slate-400">No data for this period.</p>
  const max = Math.max(1, ...data.map(d => Math.max(d.leads, d.appointments)))
  return (
    <div>
      <div className="flex items-end gap-1 h-32">
        {data.map(d => (
          <Tooltip key={d.date} text={`${d.date} — ${d.leads} lead${d.leads === 1 ? '' : 's'} received, ${d.appointments} appointment${d.appointments === 1 ? '' : 's'} scheduled`}>
            <div className="flex-1 flex items-end justify-center gap-0.5 h-32 cursor-default">
              <div className="w-1/2 bg-teal-400 rounded-t-sm hover:bg-teal-500 transition-colors" style={{ height: `${(d.leads / max) * 100}%` }} />
              <div className="w-1/2 bg-indigo-300 rounded-t-sm hover:bg-indigo-400 transition-colors" style={{ height: `${(d.appointments / max) * 100}%` }} />
            </div>
          </Tooltip>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
      <div className="flex gap-3 mt-2 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-teal-400" />Leads</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-indigo-300" />Appointments</span>
      </div>
    </div>
  )
}

export function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div>
        <h2 className="font-medium text-slate-700 text-sm">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

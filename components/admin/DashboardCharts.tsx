'use client'

import { useState } from 'react'

// ── Tooltip (CSS-only) ────────────────────────────────────────────────────────
function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="relative group/tip inline-block w-full">
      {children}
      <div className="pointer-events-none absolute z-20 left-1/2 -translate-x-1/2 bottom-full mb-2 w-max max-w-[260px] rounded-md bg-slate-900 text-white text-[11px] leading-snug px-2.5 py-1.5 opacity-0 scale-95 group-hover/tip:opacity-100 group-hover/tip:scale-100 transition-all duration-150 shadow-lg whitespace-normal">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
      </div>
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────
export function Panel({
  title, subtitle, children, action,
}: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-800 text-sm">{title}</h2>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

// ── KPICard ───────────────────────────────────────────────────────────────────
export function KPICard({
  label, value, sub, tone = 'text-slate-800', delta, tooltip, accent,
}: {
  label: string; value: string | number; sub?: string; tone?: string
  delta?: number | null; tooltip?: string; accent?: string
}) {
  const card = (
    <div className="bg-white rounded-xl border border-slate-200 p-4 h-full hover:border-slate-300 transition-colors relative overflow-hidden">
      {accent && <div className={`absolute bottom-0 left-0 right-0 h-1 ${accent}`} />}
      <div className="text-xs text-slate-500 flex items-center gap-1">
        {label}
        {tooltip && (
          <span className="text-slate-300 text-[10px] border border-slate-300 rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none flex-shrink-0">?</span>
        )}
      </div>
      <div className="flex items-baseline gap-1.5 flex-wrap">
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

// ── GaugeMeter ────────────────────────────────────────────────────────────────
// Semicircular arc gauge. good/warn are the thresholds (as % of max).
export function GaugeMeter({
  value, max = 100, label, sublabel, good = 70, warn = 40,
}: { value: number; max?: number; label: string; sublabel?: string; good?: number; warn?: number }) {
  const pct = Math.min(100, Math.max(0, Math.round((value / max) * 100)))
  const color = pct >= good ? '#10b981' : pct >= warn ? '#f59e0b' : '#f43f5e'
  // SVG semicircle: center (60,65), R=50 → arc from (10,65) to (110,65)
  const circ = Math.PI * 50
  const offset = circ * (1 - pct / 100)
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col items-center text-center">
      <svg viewBox="0 0 120 72" className="w-32 h-20">
        <defs>
          <linearGradient id={`gauge-track-${label.replace(/\s/g,'')}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#f59e0b" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        {/* Track */}
        <path d="M10,65 A50,50 0 0,1 110,65" fill="none" stroke="#e2e8f0" strokeWidth={9} strokeLinecap="round" />
        {/* Value */}
        <path
          d="M10,65 A50,50 0 0,1 110,65"
          fill="none"
          stroke={color}
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={`${circ}`}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(.4,0,.2,1)' }}
        />
        <text x="60" y="56" textAnchor="middle" fontSize="22" fontWeight="800" fill={color}>{value}%</text>
      </svg>
      <p className="text-xs font-semibold text-slate-700 -mt-1">{label}</p>
      {sublabel && <p className="text-[10px] text-slate-400 mt-0.5">{sublabel}</p>}
    </div>
  )
}

// ── LineAreaChart (SVG, crosshair tooltip) ────────────────────────────────────
type TrendPoint = { date: string; leads: number; appointments: number }

export function LineAreaChart({ data }: { data: TrendPoint[] }) {
  const [hover, setHover] = useState<(TrendPoint & { x: number }) | null>(null)
  if (data.length === 0) return <p className="text-sm text-slate-400">No data for this period.</p>

  const W = 560, H = 160
  const PAD = { top: 12, right: 12, bottom: 28, left: 34 }
  const iW = W - PAD.left - PAD.right
  const iH = H - PAD.top - PAD.bottom

  const maxY = Math.max(1, ...data.map(d => Math.max(d.leads, d.appointments)))
  const niceMax = Math.ceil(maxY / 5) * 5
  const yS = (v: number) => iH - (v / niceMax) * iH
  const xS = (i: number) => data.length < 2 ? iW / 2 : (i / (data.length - 1)) * iW

  const leadsPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xS(i).toFixed(1)},${yS(d.leads).toFixed(1)}`).join(' ')
  const apptPath  = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xS(i).toFixed(1)},${yS(d.appointments).toFixed(1)}`).join(' ')
  const leadsArea = `${leadsPath} L${xS(data.length - 1).toFixed(1)},${iH} L0,${iH} Z`
  const apptArea  = `${apptPath}  L${xS(data.length - 1).toFixed(1)},${iH} L0,${iH} Z`

  const gridVals = [0, Math.round(niceMax * 0.25), Math.round(niceMax * 0.5), Math.round(niceMax * 0.75), niceMax]

  const labelIdxs: number[] = []
  if (data.length <= 8) {
    data.forEach((_, i) => labelIdxs.push(i))
  } else {
    const step = Math.floor(data.length / 7)
    for (let i = 0; i < data.length; i += step) labelIdxs.push(i)
    if (labelIdxs[labelIdxs.length - 1] !== data.length - 1) labelIdxs.push(data.length - 1)
  }

  function fmt(iso: string) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 200 }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="lg-leads" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0d9488" stopOpacity="0.20" />
            <stop offset="100%" stopColor="#0d9488" stopOpacity="0.01" />
          </linearGradient>
          <linearGradient id="lg-appt" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.01" />
          </linearGradient>
          <clipPath id="lc-clip">
            <rect x="0" y="0" width={iW} height={iH} />
          </clipPath>
        </defs>
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {/* Grid */}
          {gridVals.map(v => (
            <g key={v}>
              <line x1={0} y1={yS(v).toFixed(1)} x2={iW} y2={yS(v).toFixed(1)} stroke="#f1f5f9" strokeWidth={1} />
              <text x={-5} y={yS(v)} dominantBaseline="middle" textAnchor="end" fontSize={9} fill="#94a3b8">{v}</text>
            </g>
          ))}

          {/* Baseline */}
          <line x1={0} y1={iH} x2={iW} y2={iH} stroke="#e2e8f0" strokeWidth={1} />

          {/* Areas */}
          <g clipPath="url(#lc-clip)">
            <path d={apptArea}  fill="url(#lg-appt)" />
            <path d={leadsArea} fill="url(#lg-leads)" />
          </g>

          {/* Lines */}
          <g clipPath="url(#lc-clip)">
            <path d={apptPath}  fill="none" stroke="#6366f1" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={leadsPath} fill="none" stroke="#0d9488" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </g>

          {/* Crosshair + dots */}
          {hover && (() => {
            const idx = data.findIndex(d => d.date === hover.date)
            if (idx < 0) return null
            const x = xS(idx)
            return (
              <>
                <line x1={x} y1={0} x2={x} y2={iH} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3,3" />
                <circle cx={x} cy={yS(hover.leads)}        r={4} fill="#0d9488" stroke="white" strokeWidth={1.5} />
                <circle cx={x} cy={yS(hover.appointments)} r={4} fill="#6366f1" stroke="white" strokeWidth={1.5} />
              </>
            )
          })()}

          {/* Invisible hover hit targets */}
          {data.map((d, i) => {
            const x = xS(i)
            const prev = i > 0 ? xS(i - 1) : x
            const next = i < data.length - 1 ? xS(i + 1) : x
            const left = (x + prev) / 2, right = (x + next) / 2
            return (
              <rect
                key={d.date}
                x={i === 0 ? 0 : left}
                y={0}
                width={i === 0 ? right : i === data.length - 1 ? iW - left : right - left}
                height={iH}
                fill="transparent"
                style={{ cursor: 'crosshair' }}
                onMouseEnter={() => setHover({ ...d, x })}
              />
            )
          })}

          {/* X labels */}
          {labelIdxs.map(i => (
            <text key={i} x={xS(i)} y={iH + 14} textAnchor="middle" fontSize={9} fill="#94a3b8">
              {fmt(data[i].date)}
            </text>
          ))}
        </g>
      </svg>

      {/* Hover tooltip */}
      <div className="h-8 flex items-center">
        {hover ? (
          <div className="inline-flex items-center gap-3 bg-slate-900 text-white text-xs rounded-lg px-3 py-1.5 shadow-lg">
            <span className="text-slate-400">{fmt(hover.date)}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-teal-400 rounded" />{hover.leads} leads</span>
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-indigo-400 rounded" />{hover.appointments} appts</span>
          </div>
        ) : (
          <div className="flex gap-4 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-teal-500 rounded-full inline-block" />Leads received</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-indigo-500 rounded-full inline-block" />Appointments scheduled</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── DonutChart (SVG) ──────────────────────────────────────────────────────────
const DONUT_HEX = ['#0d9488','#6366f1','#f59e0b','#10b981','#f43f5e','#8b5cf6','#e87ba4','#eb6834']

export function DonutChart({
  items, centerLabel,
}: { items: { label: string; count: number }[]; centerLabel?: string }) {
  const [active, setActive] = useState<number | null>(null)
  if (items.length === 0) return <p className="text-sm text-slate-400">No data for this period.</p>
  const total = items.reduce((s, i) => s + i.count, 0)
  if (total === 0) return <p className="text-sm text-slate-400">No data for this period.</p>

  const visible = items.slice(0, 8)
  const R = 58, r = 36, cx = 78, cy = 78, GAP = 0.025

  let angle = -Math.PI / 2
  const slices = visible.map((item, i) => {
    const frac = item.count / total
    const sa = angle + GAP / 2
    const ea = angle + frac * 2 * Math.PI - GAP / 2
    angle += frac * 2 * Math.PI
    const lg = frac > 0.5 ? 1 : 0
    const x1 = cx + R * Math.cos(sa), y1 = cy + R * Math.sin(sa)
    const x2 = cx + R * Math.cos(ea), y2 = cy + R * Math.sin(ea)
    const ix1 = cx + r * Math.cos(sa), iy1 = cy + r * Math.sin(sa)
    const ix2 = cx + r * Math.cos(ea), iy2 = cy + r * Math.sin(ea)
    return {
      ...item,
      d: `M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${lg},1 ${x2.toFixed(2)},${y2.toFixed(2)} L${ix2.toFixed(2)},${iy2.toFixed(2)} A${r},${r} 0 ${lg},0 ${ix1.toFixed(2)},${iy1.toFixed(2)} Z`,
      color: DONUT_HEX[i % DONUT_HEX.length],
      pct: Math.round(frac * 100),
      i,
    }
  })

  const hov = active != null ? slices[active] : null

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg viewBox="0 0 156 156" className="w-36 h-36 flex-shrink-0">
        {slices.map(s => (
          <path
            key={s.label}
            d={s.d}
            fill={s.color}
            opacity={active == null || active === s.i ? 1 : 0.35}
            className="cursor-pointer transition-opacity duration-150"
            onMouseEnter={() => setActive(s.i)}
            onMouseLeave={() => setActive(null)}
          />
        ))}
        <text x={cx} y={cy - 9} textAnchor="middle" fontSize={19} fontWeight="800" fill="#0f172a">
          {hov ? `${hov.pct}%` : (centerLabel || total)}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize={8.5} fill="#64748b">
          {hov ? hov.label.substring(0, 16) : 'total'}
        </text>
      </svg>
      <div className="flex-1 space-y-1.5 min-w-0">
        {slices.map(s => (
          <div
            key={s.label}
            className="flex items-center gap-2 cursor-default"
            onMouseEnter={() => setActive(s.i)}
            onMouseLeave={() => setActive(null)}
          >
            <span
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0 transition-opacity"
              style={{ background: s.color, opacity: active == null || active === s.i ? 1 : 0.35 }}
            />
            <span className="text-xs text-slate-600 truncate flex-1">{s.label}</span>
            <span className="text-xs font-medium text-slate-500 whitespace-nowrap">{s.count} <span className="text-slate-300">({s.pct}%)</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── HBarList (horizontal bars, 24px height) ───────────────────────────────────
const BAR_HEX = ['#0d9488','#6366f1','#f59e0b','#10b981','#f43f5e','#8b5cf6','#e87ba4','#eb6834']

export function HBarList({
  items, colorFor, unit, maxItems = 12,
}: {
  items: { label: string; count: number }[]
  colorFor?: (label: string, i: number) => string
  unit?: string
  maxItems?: number
}) {
  const visible = items.slice(0, maxItems)
  const max = Math.max(1, ...visible.map(i => i.count))
  const total = visible.reduce((s, i) => s + i.count, 0)
  if (visible.length === 0) return <p className="text-sm text-slate-400">No data for this period.</p>
  return (
    <div className="space-y-2">
      {visible.map((item, i) => {
        const pct = total > 0 ? Math.round((item.count / total) * 100) : 0
        const display = unit ? `${unit}${item.count.toLocaleString()}` : item.count.toLocaleString()
        // colorFor may return a Tailwind class (bg-*) or a hex string
        const colorRaw = colorFor ? colorFor(item.label, i) : BAR_HEX[i % BAR_HEX.length]
        const isHex = colorRaw.startsWith('#')
        return (
          <div key={item.label} className="group/bar">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-700 truncate pr-3">{item.label}</span>
              <span className="text-slate-500 whitespace-nowrap tabular-nums">
                {display} <span className="text-slate-300">({pct}%)</span>
              </span>
            </div>
            <div className="h-5 bg-slate-100 rounded-md overflow-hidden">
              <div
                className={`h-full rounded-md transition-all duration-300 ${isHex ? '' : colorRaw}`}
                style={{
                  width: `${Math.max((item.count / max) * 100, 2)}%`,
                  ...(isHex ? { backgroundColor: colorRaw } : {}),
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── BarList (compat shim → delegates to HBarList) ─────────────────────────────
export function BarList(props: {
  items: { label: string; count: number }[]
  colorFor?: (label: string, i: number) => string
  unit?: string
}) {
  return <HBarList {...props} />
}

// ── FunnelChart (numbered steps + conversion rates) ───────────────────────────
const FUNNEL_HEX = ['#0d9488', '#6366f1', '#10b981', '#f59e0b']

export function FunnelChart({ steps }: { steps: { label: string; count: number; hint?: string }[] }) {
  const max = Math.max(1, ...steps.map(s => s.count))
  return (
    <div className="space-y-1">
      {steps.map((s, i) => {
        const pctOfMax  = (s.count / max) * 100
        const pctOfPrev = i === 0 ? null : steps[i - 1].count > 0
          ? Math.round((s.count / steps[i - 1].count) * 100) : 0
        const dropOff   = pctOfPrev != null ? 100 - pctOfPrev : null
        const color     = FUNNEL_HEX[i] || '#94a3b8'
        return (
          <div key={s.label}>
            {i > 0 && (
              <div className="flex items-center gap-2 my-1.5 ml-3">
                <div className="w-px h-4 bg-slate-200" />
                <span className="text-[10px] text-slate-400 font-medium">
                  {pctOfPrev}% conversion · {dropOff}% dropped off
                </span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                style={{ backgroundColor: color }}
              >
                {i + 1}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700">{s.label}</span>
                  <span className="text-slate-600 font-semibold tabular-nums">{s.count.toLocaleString()}</span>
                </div>
                <Tooltip text={`${s.label}: ${s.count}${s.hint ? ` — ${s.hint}` : ''}${pctOfPrev != null ? ` (${pctOfPrev}% of "${steps[i - 1].label}")` : ''}`}>
                  <div className="h-7 bg-slate-100 rounded-lg overflow-hidden">
                    <div
                      className="h-full rounded-lg transition-all duration-500"
                      style={{ width: `${Math.max(pctOfMax, 3)}%`, backgroundColor: color }}
                    />
                  </div>
                </Tooltip>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── AgentTable (leads + booked as overlapping bars) ───────────────────────────
export function AgentTable({
  rows,
}: { rows: { agent: string; leads: number; booked: number; booking_rate: number | null }[] }) {
  if (rows.length === 0) return <p className="text-sm text-slate-400">No agent-attributed leads this period.</p>
  const maxLeads = Math.max(1, ...rows.map(r => r.leads))
  return (
    <div className="space-y-3">
      {rows.map(r => {
        const rate = r.booking_rate ?? 0
        const rateColor = rate >= 60 ? 'text-emerald-600' : rate >= 35 ? 'text-amber-600' : 'text-rose-600'
        return (
          <div key={r.agent}>
            <div className="flex items-center justify-between text-xs mb-1 gap-2">
              <span className="font-medium text-slate-700 truncate">{r.agent}</span>
              <span className="flex items-center gap-3 text-slate-400 flex-shrink-0">
                <span className="tabular-nums">{r.leads} leads</span>
                <span className="tabular-nums">{r.booked} booked</span>
                <span className={`font-bold tabular-nums ${rateColor}`}>{rate}%</span>
              </span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden relative">
              <div className="absolute top-0 left-0 h-full bg-slate-200 rounded-full" style={{ width: `${(r.leads / maxLeads) * 100}%` }} />
              <div className="absolute top-0 left-0 h-full bg-teal-500 rounded-full" style={{ width: `${(r.booked / maxLeads) * 100}%` }} />
            </div>
          </div>
        )
      })}
      <div className="flex gap-4 text-[10px] text-slate-400 pt-1">
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 bg-slate-200 rounded-full inline-block" />Total leads</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 bg-teal-500 rounded-full inline-block" />Booked</span>
      </div>
    </div>
  )
}

// ── DoctorTable (no-show rate as inline progress bar) ─────────────────────────
function money(n: number) { return `৳${Math.round(n).toLocaleString()}` }

export function DoctorTable({
  rows,
}: { rows: { doctor: string; appointments: number; no_show_rate: number | null; revenue: number }[] }) {
  if (rows.length === 0) return <p className="text-sm text-slate-400">No appointments this period.</p>
  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-400 uppercase border-b border-slate-100">
            <th className="text-left pb-2 font-medium">Doctor</th>
            <th className="text-right pb-2 font-medium pr-2">Appts</th>
            <th className="pb-2 font-medium w-32">No-show rate</th>
            <th className="text-right pb-2 font-medium">Revenue</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map(r => {
            const rate = r.no_show_rate ?? 0
            const barColor = rate > 40 ? '#f43f5e' : rate > 20 ? '#f59e0b' : '#10b981'
            const textColor = rate > 40 ? 'text-rose-600' : rate > 20 ? 'text-amber-600' : 'text-emerald-600'
            return (
              <tr key={r.doctor} className="hover:bg-slate-50">
                <td className="py-2 truncate max-w-[150px] font-medium text-slate-700">{r.doctor}</td>
                <td className="py-2 text-right pr-3 text-slate-500 tabular-nums">{r.appointments}</td>
                <td className="py-2 px-1">
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(rate, 100)}%`, backgroundColor: barColor }}
                      />
                    </div>
                    <span className={`text-xs font-semibold w-9 text-right tabular-nums ${textColor}`}>
                      {r.no_show_rate != null ? `${rate}%` : '—'}
                    </span>
                  </div>
                </td>
                <td className="py-2 text-right text-slate-700 tabular-nums">{money(r.revenue)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-[10px] text-slate-400 mt-2">
        No-show rate is invoice-validated — attended = matching invoice exists nearby, across all invoice types
      </p>
    </div>
  )
}

// ── TrendChart (compat shim → LineAreaChart) ──────────────────────────────────
export function TrendChart({ data }: { data: { date: string; leads: number; appointments: number }[] }) {
  return <LineAreaChart data={data} />
}

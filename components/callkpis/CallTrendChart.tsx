'use client'

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

export default function CallTrendChart({ data }: { data: { date: string; incoming: number; outgoing: number }[] }) {
  if (data.length === 0) return <p className="text-sm text-slate-400">No data for this period.</p>
  const max = Math.max(1, ...data.map(d => Math.max(d.incoming, d.outgoing)))
  return (
    <div>
      <div className="flex items-end gap-1 h-32">
        {data.map(d => (
          <Tooltip key={d.date} text={`${d.date} — ${d.incoming} incoming, ${d.outgoing} outgoing`}>
            <div className="flex-1 flex items-end justify-center gap-0.5 h-32 cursor-default">
              <div className="w-1/2 bg-teal-400 rounded-t-sm hover:bg-teal-500 transition-colors" style={{ height: `${(d.incoming / max) * 100}%` }} />
              <div className="w-1/2 bg-indigo-300 rounded-t-sm hover:bg-indigo-400 transition-colors" style={{ height: `${(d.outgoing / max) * 100}%` }} />
            </div>
          </Tooltip>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
      <div className="flex gap-3 mt-2 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-teal-400" />Incoming</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-indigo-300" />Outgoing</span>
      </div>
    </div>
  )
}

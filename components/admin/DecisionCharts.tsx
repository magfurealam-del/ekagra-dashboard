"use client";
import type { ReactNode } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatNumber } from "@/lib/dashboard-presentation";
import { rateText, type CountRow } from "@/lib/decision-dashboard";

export function ChartPanel({
  title,
  subtitle,
  children,
  action,
  className = "",
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-xl border border-slate-200 bg-white p-5 sm:p-6 ${className}`}
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-slate-950">
            {title}
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
            {subtitle}
          </p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Empty({
  text = "No records in this reporting period.",
}: {
  text?: string;
}) {
  return (
    <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
      {text}
    </p>
  );
}
export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 text-xs leading-relaxed text-slate-600">{children}</p>
  );
}
export function PageIntro({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-5">
      <p className="text-xs font-medium uppercase tracking-[.13em] text-teal-800">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
        {title}
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
        {children}
      </p>
    </div>
  );
}
export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-white p-5">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p className="mt-2 break-words text-2xl font-semibold tracking-tight tabular-nums text-slate-950">
        {value}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-slate-600">{sub}</p>
    </div>
  );
}
export function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
      {label}
      <select
        aria-label={label}
        className="min-h-10 max-w-full rounded-lg border bg-white px-3 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-teal-700"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
export function RankedBars({
  rows,
  formatter = formatNumber,
  color = "#0f766e",
}: {
  rows: CountRow[];
  formatter?: (n: number) => string;
  color?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <Empty />;
  return (
    <ul className="space-y-4">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-2 flex justify-between gap-3 text-sm">
            <span className="min-w-0 break-words text-slate-700">
              {r.label}
            </span>
            <strong className="shrink-0 font-medium tabular-nums">
              {formatter(r.count)}
            </strong>
          </div>
          <div className="h-2 rounded-full bg-slate-100" aria-hidden="true">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(0, (r.count / max) * 100)}%`,
                backgroundColor: color,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
type Series = { key: string; label: string; color: string };
type StackRow = { label: string; values: Record<string, number> };
export function StackedBars({
  rows,
  series,
  percent = false,
}: {
  rows: StackRow[];
  series: Series[];
  percent?: boolean;
}) {
  const total = (row: StackRow) =>
    series.reduce((s, k) => s + (row.values[k.key] ?? 0), 0);
  const max = Math.max(1, ...rows.map(total));
  if (!rows.length) return <Empty />;
  return (
    <>
      <div className="mb-5 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-2">
            <span
              className="size-2.5 rounded-sm"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <div className="space-y-5">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="mb-2 flex justify-between gap-3 text-sm">
              <span>{r.label}</span>
              <strong className="font-medium tabular-nums">
                {formatNumber(total(r))}
              </strong>
            </div>
            <div
              className="flex h-5 overflow-hidden rounded bg-slate-100"
              aria-hidden="true"
            >
              {series.map((s) => (
                <span
                  key={s.key}
                  style={{
                    backgroundColor: s.color,
                    width: `${((r.values[s.key] ?? 0) / (percent ? Math.max(1, total(r)) : max)) * 100}%`,
                  }}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              {series.map((s) => (
                <span key={s.key}>
                  {s.label}:{" "}
                  <strong className="font-medium tabular-nums">
                    {formatNumber(r.values[s.key] ?? 0)}
                    {percent
                      ? ` (${rateText(r.values[s.key] ?? 0, total(r))})`
                      : ""}
                  </strong>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
export function RateDots({
  rows,
}: {
  rows: { label: string; numerator: number; denominator: number }[];
}) {
  if (!rows.length) return <Empty />;
  return (
    <>
      <div className="mb-3 flex justify-between text-[11px] text-slate-500">
        <span>0%</span>
        <span>Same scale for every row</span>
        <span>100%</span>
      </div>
      <div className="space-y-5">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="mb-2 flex justify-between gap-3 text-sm">
              <span>{r.label}</span>
              <span className="text-right tabular-nums">
                <strong className="font-semibold">
                  {rateText(r.numerator, r.denominator)}
                </strong>
                <span className="ml-2 text-xs text-slate-600">
                  {r.numerator}/{r.denominator}
                </span>
              </span>
            </div>
            <div
              className="relative h-1.5 rounded bg-slate-100"
              aria-hidden="true"
            >
              {r.denominator > 0 && (
                <span
                  className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-white bg-teal-700 shadow-sm"
                  style={{
                    left: `calc(${Math.min(100, (r.numerator / r.denominator) * 100)}% - 6px)`,
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
export function TrendChart({
  data,
  series,
  currency = false,
}: {
  data: { date: string; [key: string]: number | string | null }[];
  series: Series[];
  currency?: boolean;
}) {
  if (!data.length) return <Empty />;
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-600">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-2">
            <span className="h-0.5 w-5" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <ChartContainer
        className="aspect-auto h-[240px] w-full"
        config={Object.fromEntries(
          series.map((s) => [s.key, { label: s.label, color: s.color }]),
        )}
      >
        <LineChart
          accessibilityLayer
          data={data}
          margin={{ left: 0, right: 12, top: 10, bottom: 5 }}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 4" />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            minTickGap={35}
            tickFormatter={(v) =>
              new Date(`${v}T12:00:00Z`).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                timeZone: "UTC",
              })
            }
          />
          <YAxis
            width={54}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            domain={[0, "auto"]}
            tickFormatter={(v) =>
              currency
                ? `${Number(v) >= 1000 ? `${Number(v) / 1000}k` : v}`
                : String(v)
            }
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={2.5}
              strokeDasharray={i % 2 ? "5 4" : undefined}
              dot={data.length === 1}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
      <details className="mt-3">
        <summary className="min-h-8 cursor-pointer text-xs font-medium text-teal-800">
          View chart data
        </summary>
        <DataTable
          headers={["Bangladesh date", ...series.map((s) => s.label)]}
          rows={data.map((r) => [
            r.date,
            ...series.map((s) =>
              r[s.key] == null
                ? "Not yet eligible"
                : `${currency ? "৳" : ""}${Number(r[s.key]).toLocaleString()}`,
            ),
          ])}
        />
      </details>
    </>
  );
}
export function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  if (!rows.length) return <Empty />;
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-xs text-slate-600">
            {headers.map((h) => (
              <th
                key={h}
                scope="col"
                className="whitespace-nowrap px-3 py-3 first:pl-0 font-medium"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-3 first:pl-0 tabular-nums">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <Empty />}
    </div>
  );
}

export function DelayPlot({
  rows,
}: {
  rows: {
    name: string;
    scheduled: number;
    median_days: number | null;
    p75_days: number | null;
  }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.p75_days ?? 0));
  if (!rows.length) return <Empty />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-600">
        <span>● Median · line extends to 75th percentile</span>
        <span>Scale: 0–{Number(max.toFixed(1))} days</span>
      </div>
      {rows.map((r) => (
        <div key={r.name}>
          <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
            <span>{r.name}</span>
            <span className="text-xs tabular-nums text-slate-600">
              {r.median_days == null
                ? "No scheduled visits"
                : `Median ${Number(r.median_days.toFixed(1))}d · P75 ${Number((r.p75_days ?? 0).toFixed(1))}d · N=${r.scheduled}`}
            </span>
          </div>
          <div
            className="relative h-1.5 rounded bg-slate-100"
            aria-hidden="true"
          >
            {r.median_days != null && (
              <>
                <span
                  className="absolute top-0 h-full rounded bg-teal-200"
                  style={{
                    left: `${(r.median_days / max) * 100}%`,
                    width: `${(((r.p75_days ?? r.median_days) - r.median_days) / max) * 100}%`,
                  }}
                />
                <span
                  className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-white bg-teal-700"
                  style={{
                    left: `calc(${(r.median_days / max) * 100}% - 6px)`,
                  }}
                />
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
export function WorkflowLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-medium text-teal-900 hover:bg-teal-100"
    >
      {children}
      <span aria-hidden="true">↗</span>
    </a>
  );
}

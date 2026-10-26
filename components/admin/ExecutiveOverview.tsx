'use client'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Info,
  ShieldCheck,
} from 'lucide-react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  change,
  formatMoney,
  formatNumber,
  percentage,
  type DashboardTab,
  type ExecutiveMetrics,
} from '@/lib/dashboard-presentation'

function Metric({
  label,
  value,
  description,
  definition,
  delta,
  unit = '%',
  comparing,
  onClick,
}: {
  label: string
  value: string
  description: string
  definition: string
  delta: number | null
  unit?: string
  comparing: boolean
  onClick: () => void
}) {
  return (
    <Card className="gap-0 py-0 shadow-none">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2 text-sm font-medium text-slate-600">
          <span>{label}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={`Definition: ${label}`}
                className="flex size-8 items-center justify-center rounded-md hover:bg-slate-100"
              >
                <Info className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72 text-sm">
              {definition}
            </TooltipContent>
          </Tooltip>
        </div>
        <button
          className="mt-2 block rounded text-left text-[23px] font-semibold sm:text-[32px] leading-tight tracking-tight text-slate-950 tabular-nums hover:text-teal-800"
          onClick={onClick}
          aria-label={`Explore ${label}: ${value}`}
        >
          {value}
        </button>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          {description}
        </p>
        <div className="mt-4 min-h-5 text-xs text-slate-600">
          {comparing ? (
            delta == null ? (
              'Comparison unavailable'
            ) : (
              <span className="flex items-center gap-1">
                {delta > 0 ? (
                  <ArrowUpRight className="size-3.5" />
                ) : delta < 0 ? (
                  <ArrowDownRight className="size-3.5" />
                ) : null}
                <strong>
                  {delta > 0 ? '+' : ''}
                  {delta}
                  {unit}
                </strong>{' '}
                vs previous period
              </span>
            )
          ) : (
            <button
              onClick={onClick}
              className="inline-flex items-center gap-1 font-medium text-teal-800"
            >
              Explore details
              <ArrowRight className="size-3" />
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-slate-900">
          {title}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          {subtitle}
        </p>
      </div>
      {action}
    </div>
  )
}
export function ExecutiveOverview({
  metrics,
  previous,
  compare,
  onSelect,
}: {
  metrics: ExecutiveMetrics
  previous: ExecutiveMetrics | null
  compare: boolean
  onSelect: (tab: DashboardTab) => void
}) {
  const bookingRate = percentage(metrics.booked_leads, metrics.total_leads)
  const previousRate = percentage(previous?.booked_leads, previous?.total_leads)
  const trend = metrics.daily_trend ?? []
  const sources = [...(metrics.revenue_by_source ?? [])].sort(
    (a, b) => b.revenue - a.revenue,
  )
  const totalSourceRevenue = sources.reduce(
    (sum, item) => sum + item.revenue,
    0,
  )
  const otherSources = sources
    .slice(5)
    .reduce((sum, item) => sum + item.revenue, 0)
  const visibleSources = sources
    .slice(0, 5)
    .concat(
      sources.length > 5
        ? [{ source: 'Other sources', revenue: otherSources }]
        : [],
    )
  const proofGap = metrics.completed_appointments_without_mis_visit_proof
  return (
    <div className="space-y-6">
      <section
        aria-label="Executive scorecard"
        className="grid grid-cols-2 gap-3 xl:grid-cols-4"
      >
        <Metric
          label="CRM-attributed revenue"
          value={formatMoney(metrics.total_revenue)}
          description="BDT · matched CRM invoice revenue"
          definition="Revenue attributed to CRM leads from validated billing links, dated in the selected period. This is not total hospital revenue or a return-on-ad-spend metric."
          delta={change(metrics.total_revenue, previous?.total_revenue)}
          comparing={compare}
          onClick={() => onSelect('revenue')}
        />
        <Metric
          label="MIS-verified visits"
          value={formatNumber(metrics.mis_verified_attended)}
          description="Eligible completed visits with strict evidence"
          definition="Eligible completed appointments supported by patient, encounter date, physician and a unique non-void MIS invoice with positive billed value. This is billing evidence, not proof of payment collected. One full Bangladesh calendar day is allowed for evidence."
          delta={change(
            metrics.mis_verified_attended,
            previous?.mis_verified_attended,
          )}
          comparing={compare}
          onClick={() => onSelect('quality')}
        />
        <Metric
          label="Lead booking rate"
          value={bookingRate == null ? '—' : `${bookingRate}%`}
          description={`${formatNumber(metrics.booked_leads)} booked / ${formatNumber(metrics.total_leads)} leads`}
          definition="Booked intake leads divided by all leads dated in the reporting period. This is lead conversion, not the attendance rate of appointments scheduled for that period."
          delta={
            bookingRate != null && previousRate != null
              ? Math.round((bookingRate - previousRate) * 10) / 10
              : null
          }
          unit=" pp"
          comparing={compare}
          onClick={() => onSelect('agents')}
        />
        <Metric
          label="Total leads"
          value={formatNumber(metrics.total_leads)}
          description="Contacts logged during the period"
          definition="Logged lead records by contact date. These are contacts, not necessarily distinct patients. Date presets use Bangladesh time; underlying legacy date boundaries still require alignment."
          delta={change(metrics.total_leads, previous?.total_leads)}
          comparing={compare}
          onClick={() => onSelect('channels')}
        />
      </section>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(300px,1fr)]">
        <section className="min-w-0 rounded-xl border bg-white p-5 sm:p-6">
          <SectionTitle
            title="Demand & appointment activity"
            subtitle="Leads by contact date · appointments by scheduled visit date"
            action={
              <Badge variant="outline" className="font-normal text-slate-600">
                Daily volume
              </Badge>
            }
          />
          <div className="mb-4 flex flex-wrap gap-5 text-xs text-slate-600">
            <span className="flex items-center gap-2">
              <span className="h-0.5 w-5 bg-teal-700" />
              Leads received
            </span>
            <span className="flex items-center gap-2">
              <span className="h-0.5 w-5 border-t-2 border-dashed border-slate-500" />
              Appointments scheduled
            </span>
          </div>
          {trend.length ? (
            <ChartContainer
              className="h-[240px] w-full aspect-auto"
              config={{
                leads: { label: 'Leads received', color: '#0f766e' },
                appointments: {
                  label: 'Appointments scheduled',
                  color: '#64748b',
                },
              }}
            >
              <LineChart
                accessibilityLayer
                data={trend}
                margin={{ left: -20, right: 12, top: 8, bottom: 8 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 4" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={35}
                  tickMargin={12}
                  tickFormatter={(value) =>
                    new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      timeZone: 'UTC',
                    })
                  }
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => String(value)}
                    />
                  }
                />
                <Line
                  type="linear"
                  dataKey="leads"
                  stroke="var(--color-leads)"
                  strokeWidth={2.5}
                  dot={trend.length === 1}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="appointments"
                  stroke="var(--color-appointments)"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={trend.length === 1}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
          ) : (
            <div className="flex h-60 items-center justify-center text-sm text-slate-500">
              No daily activity is available for this period.
            </div>
          )}
          <details className="mt-4 border-t pt-3">
            <summary className="cursor-pointer text-xs font-medium text-teal-800">
              View accessible daily data
            </summary>
            <div className="mt-3 max-h-60 overflow-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  Daily leads and scheduled appointments
                </caption>
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="py-2">
                      Date
                    </th>
                    <th scope="col">Leads</th>
                    <th scope="col">Appointments</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((row) => (
                    <tr key={row.date} className="border-b">
                      <th scope="row" className="py-2 font-normal">
                        {row.date}
                      </th>
                      <td>{row.leads}</td>
                      <td>{row.appointments}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <section className="rounded-xl border bg-white p-5 sm:p-6">
          <SectionTitle
            title="Where to focus"
            subtitle="Follow-up priorities as of this report"
          />
          <div className="divide-y">
            <div className="pb-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-medium">Open callbacks</h3>
                <span className="text-2xl font-semibold tabular-nums">
                  {formatNumber(metrics.pending_callbacks)}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Queue at report time; independent of the selected period.
              </p>
              <Button asChild variant="link" className="mt-2 h-8 px-0">
                <a href="/outgoing-calls">
                  Open outbound workspace
                  <ArrowRight />
                </a>
              </Button>
            </div>
            <div className="py-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-medium">
                  Completed, awaiting MIS evidence
                </h3>
                <span
                  className={`text-2xl font-semibold tabular-nums ${proofGap != null && proofGap > 0 ? 'text-amber-800' : ''}`}
                >
                  {formatNumber(proofGap)}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Reconcile evidence before interpreting attendance performance.
              </p>
              <Button
                variant="link"
                className="mt-2 h-8 px-0"
                onClick={() => onSelect('quality')}
              >
                Review data quality
                <ArrowRight />
              </Button>
            </div>
            <div className="pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-medium">Recorded no-shows</h3>
                <span className="text-2xl font-semibold tabular-nums">
                  {formatNumber(metrics.explicit_crm_no_shows)}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Explicit CRM status among eligible appointments. Missing invoices alone are
                not proof of a no-show.
              </p>
              <Button asChild variant="link" className="mt-2 h-8 px-0">
                <a href="/calendar">
                  Review appointments
                  <ArrowRight />
                </a>
              </Button>
            </div>
          </div>
        </section>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border bg-white p-5 sm:p-6">
          <SectionTitle
            title="What drives attributed revenue"
            subtitle="Source mix within CRM-attributed revenue · BDT"
            action={
              <Button
                variant="ghost"
                className="text-teal-800"
                onClick={() => onSelect('channels')}
              >
                Acquisition
                <ArrowRight />
              </Button>
            }
          />
          {visibleSources.length ? (
            <div className="space-y-4">
              {visibleSources.map((row) => (
                <div key={row.source}>
                  <div className="mb-2 flex justify-between gap-4 text-sm">
                    <span className="capitalize text-slate-700">
                      {row.source}
                    </span>
                    <span className="whitespace-nowrap font-medium tabular-nums">
                      {formatMoney(row.revenue)}{' '}
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {percentage(row.revenue, totalSourceRevenue) ?? 0}%
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-teal-700"
                      style={{
                        width: `${Math.max(0, Math.min(100, percentage(row.revenue, totalSourceRevenue) ?? 0))}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-sm text-slate-500">
              No attributed revenue is available for this period.
            </p>
          )}
          <p className="mt-5 text-xs leading-relaxed text-slate-600">
            Revenue share does not measure channel ROI. Ad spend and attribution
            coverage must be reconciled first.
          </p>
        </section>
        <section className="rounded-xl border bg-white p-5 sm:p-6">
          <SectionTitle
            title="Intake outcomes"
            subtitle="What happened to contacts logged in this period"
            action={
              <Button
                variant="ghost"
                className="text-teal-800"
                onClick={() => onSelect('funnel')}
              >
                Follow-ups
                <ArrowRight />
              </Button>
            }
          />
          <table className="w-full text-sm">
            <caption className="sr-only">
              Intake outcome counts and share of all leads
            </caption>
            <thead>
              <tr className="border-b text-xs text-slate-500">
                <th className="pb-3 text-left font-medium" scope="col">
                  Outcome
                </th>
                <th className="pb-3 text-right font-medium" scope="col">
                  Leads
                </th>
                <th className="pb-3 text-right font-medium" scope="col">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {(metrics.by_intake_outcome ?? []).map((row) => (
                <tr key={row.outcome} className="border-b last:border-0">
                  <th
                    scope="row"
                    className="py-3 text-left font-normal text-slate-700"
                  >
                    {row.outcome}
                  </th>
                  <td className="text-right font-medium tabular-nums">
                    {formatNumber(row.count)}
                  </td>
                  <td className="text-right text-slate-600 tabular-nums">
                    {percentage(row.count, metrics.total_leads) == null
                      ? '—'
                      : `${percentage(row.count, metrics.total_leads)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!metrics.by_intake_outcome?.length && (
            <p className="py-8 text-sm text-slate-500">
              No intake outcomes are available.
            </p>
          )}
        </section>
      </div>
      <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-100/60 p-4 text-xs leading-relaxed text-slate-600">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-800" />
        <p>
          <strong className="text-slate-800">A clear evidence boundary.</strong>{' '}
          Contacts, scheduled appointments, and invoices use their own dates.
          Follow-ups shows linked contact-cohort conversion. Data quality shows
          verified attendance coverage and unresolved evidence within one eligible
          appointment population. Missing invoices do not prove nonattendance.
        </p>
      </div>
    </div>
  )
}

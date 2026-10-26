'use client'
import { ArrowDownToLine, CalendarDays, Clock3, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  DASHBOARD_TABS,
  displayDate,
  snapshotAge,
  validRange,
  type DashboardTab,
  type RangeKey,
} from '@/lib/dashboard-presentation'
export function ExecutiveHeader({
  rangeKey,
  setRangeKey,
  customStart,
  customEnd,
  setCustomStart,
  setCustomEnd,
  start,
  end,
  compare,
  setCompare,
  refreshedAt,
  loading,
  reload,
  tab,
  setTab,
}: {
  rangeKey: RangeKey
  setRangeKey: (key: RangeKey) => void
  customStart: string
  customEnd: string
  setCustomStart: (value: string) => void
  setCustomEnd: (value: string) => void
  start: string
  end: string
  compare: boolean
  setCompare: (value: boolean) => void
  refreshedAt: string | null
  loading: boolean
  reload: () => void
  tab: DashboardTab
  setTab: (value: DashboardTab) => void
}) {
  const age = snapshotAge(refreshedAt)
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 hidden text-xs font-medium uppercase sm:block tracking-[0.14em] text-teal-800">
            Dhanmondi · Performance intelligence
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-[34px]">
            Executive dashboard
          </h1>
          <p className="mt-2 hidden text-sm text-slate-600 sm:block">
            Acquisition, clinic visits, and the work that needs attention.
          </p>
        </div>
        <Button
          asChild
          variant="outline"
          className="hidden h-10 gap-2 bg-white sm:inline-flex"
        >
          <a href="/admin/mis-upload">
            <ArrowDownToLine className="size-4" />
            MIS imports
          </a>
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3">
        <label className="flex items-center gap-2 text-sm font-medium sm:hidden">
          Period
          <select
            aria-label="Reporting period"
            className="h-10 rounded-md border bg-white px-3"
            value={rangeKey}
            onChange={(event) => setRangeKey(event.target.value as RangeKey)}
          >
            <option value="today">Today</option>
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
            <option value="month">This month</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <div
          className="hidden flex-wrap gap-1 sm:flex"
          role="group"
          aria-label="Reporting period"
        >
          {(
            [
              { key: 'today', label: 'Today' },
              { key: '7d', label: '7 days' },
              { key: '30d', label: '30 days' },
              { key: 'month', label: 'This month' },
              { key: 'custom', label: 'Custom' },
            ] as const
          ).map((range) => (
            <Button
              key={range.key}
              variant={rangeKey === range.key ? 'default' : 'ghost'}
              className="h-10 px-3"
              aria-pressed={rangeKey === range.key}
              onClick={() => setRangeKey(range.key)}
            >
              {range.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex min-h-10 cursor-pointer items-center gap-2 text-slate-600">
            <input
              type="checkbox"
              className="size-4 accent-teal-700"
              checked={compare}
              onChange={(event) => setCompare(event.target.checked)}
            />
            Compare periods
          </label>
          <Button
            variant="ghost"
            className="h-10"
            onClick={reload}
            disabled={loading || !validRange(start, end)}
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : 'Refresh report'}
          </Button>
        </div>
        {rangeKey === 'custom' && (
          <div className="flex w-full flex-wrap gap-3 border-t pt-3">
            <label className="text-xs font-medium text-slate-600">
              Start date
              <Input
                type="date"
                value={customStart}
                max={customEnd || undefined}
                onInput={(event) => setCustomStart(event.currentTarget.value)}
                className="mt-1 h-10"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              End date
              <Input
                type="date"
                value={customEnd}
                min={customStart || undefined}
                onInput={(event) => setCustomEnd(event.currentTarget.value)}
                className="mt-1 h-10"
              />
            </label>
            {!validRange(start, end) && (
              <p role="alert" className="self-end pb-2 text-sm text-red-700">
                Choose a valid period of at most 366 days, with the end on or
                after the start.
              </p>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span className="flex items-center gap-2">
          <CalendarDays className="size-3.5" />
          {validRange(start, end)
            ? `${displayDate(start)} – ${displayDate(end)}`
            : 'Select a reporting period'}{' '}
          <span className="text-slate-400">·</span> Bangladesh date presets
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Clock3 className="size-3.5" />
          <span>
            {refreshedAt
              ? `Report read ${new Date(refreshedAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} BDT`
              : 'Report time unavailable'}
          </span>
          <Badge
            variant="outline"
            className={
              age === 'stale'
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'text-slate-600'
            }
          >
            {age === 'stale' ? 'Over 26 hours old' : 'Consistent read'}
          </Badge>
        </span>
      </div>
      <label className="block text-xs font-medium text-slate-600 sm:hidden">
        Dashboard section
        <select
          aria-label="Dashboard section"
          className="mt-1 h-11 w-full rounded-lg border bg-white px-3 text-sm text-slate-900"
          value={tab}
          onChange={(event) => setTab(event.target.value as DashboardTab)}
        >
          {DASHBOARD_TABS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <nav
        aria-label="Dashboard sections"
        className="hidden flex-wrap gap-1 border-b pb-2 sm:flex"
      >
        {DASHBOARD_TABS.map((item) => (
          <Button
            key={item.key}
            variant="ghost"
            onClick={() => setTab(item.key)}
            aria-current={tab === item.key ? 'page' : undefined}
            className={`min-h-10 px-3 text-sm ${tab === item.key ? 'bg-teal-50 font-semibold text-teal-800' : 'text-slate-600'}`}
          >
            {item.label}
          </Button>
        ))}
      </nav>
    </>
  )
}

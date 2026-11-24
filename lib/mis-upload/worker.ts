// Pure runner: each tick is a separate PostgreSQL transaction. Never start a
// new RPC near the function deadline; a timed-out caller does not lose work.
export type TickResult = { status: string; stage?: string; code?: string }
// A retry result means one invoice was deferred with backoff. Keep draining
// other eligible invoices instead of letting one malformed row stall a batch.
const CONTINUE_STATUSES = new Set(['completed', 'superseded', 'advanced', 'retry', 'failed'])
// Spend/source ingestion stays overnight; an in-flight publication can recover later.
export function isOvernightInDhaka(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const minutes = Number(parts.find(p => p.type === 'hour')?.value) * 60 + Number(parts.find(p => p.type === 'minute')?.value)
  return minutes >= 15 && minutes < 465
}
export async function drainMisQueue(
  tick: () => Promise<TickResult>,
  options: { budgetMs?: number; maxTicks?: number; now?: () => number } = {},
) {
  const now = options.now ?? Date.now
  const start = now()
  const budget = options.budgetMs ?? 240_000
  const maxTicks = options.maxTicks ?? 1000
  let ticks = 0
  let last: TickResult = { status: 'budget_exhausted' }
  while (ticks < maxTicks && now() - start < budget - 125_000) {
    last = await tick()
    ticks += 1
    if (!CONTINUE_STATUSES.has(last.status)) break
  }
  return { ticks, elapsedMs: now() - start, last }
}

// Pure runner: each tick is a separate PostgreSQL transaction. Never start a
// new RPC near the function deadline; a timed-out caller does not lose work.
export type TickResult = { status: string; stage?: string; code?: string }
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
    if (!['completed', 'superseded', 'advanced'].includes(last.status)) break
  }
  return { ticks, elapsedMs: now() - start, last }
}

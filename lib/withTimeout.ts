export function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  message = 'Request timed out',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  }) as Promise<T>
}

export async function withRetry<T>(
  work: () => PromiseLike<T>,
  timeoutMs: number,
  retries = 2,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await withTimeout(work(), timeoutMs)
    } catch (error) {
      lastError = error
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 600))
    }
  }
  throw lastError
}

/**
 * Run independent Supabase calls in parallel, each with its own timeout + retries.
 * Returns a tuple of the same length as the input array; each element is the settled
 * value (data + error) or null if it threw/timed-out.
 */
export async function parallelFetch<T extends (() => PromiseLike<any>)[]>(
  tasks: { [K in keyof T]: { work: T[K]; timeoutMs?: number; retries?: number } },
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> | null }> {
  const results = await Promise.allSettled(
    tasks.map((t) => withRetry(t.work, t.timeoutMs ?? 15000, t.retries ?? 2)),
  )
  return results.map((r) => (r.status === 'fulfilled' ? r.value : null)) as any
}

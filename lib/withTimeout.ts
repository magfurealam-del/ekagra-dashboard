export function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, message = 'Request timed out') {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export async function withRetry<T>(work: () => PromiseLike<T>, timeoutMs: number, retries = 1) {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await withTimeout(work(), timeoutMs)
    } catch (error) {
      lastError = error
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw lastError
}

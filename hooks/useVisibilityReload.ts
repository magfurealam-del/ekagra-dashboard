'use client'
import { useEffect, useRef } from 'react'

/**
 * Re-runs `load` whenever the browser tab becomes visible again.
 *
 * Browsers throttle/suspend background tabs, which can silently drop
 * Supabase WebSocket connections and kill in-flight fetches. Without
 * this hook the page stays stale or shows a timeout error until the
 * user manually refreshes.
 *
 * Uses a ref so the listener always calls the latest `load` closure,
 * not the stale one captured at mount (important when load reads state).
 */
export function useVisibilityReload(load: () => void, delayMs = 400, minStaleMs = 60_000) {
  const loadRef = useRef(load)
  const lastLoadedAt = useRef(Date.now())

  useEffect(() => { loadRef.current = load })

  // Let callers signal a fresh load completed so we reset the staleness clock
  useEffect(() => {
    lastLoadedAt.current = Date.now()
  })

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastLoadedAt.current < minStaleMs) return
        setTimeout(() => loadRef.current(), delayMs)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

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
export function useVisibilityReload(load: () => void, delayMs = 400) {
  const loadRef = useRef(load)
  // Keep ref current on every render without re-running the listener effect
  useEffect(() => { loadRef.current = load })

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        setTimeout(() => loadRef.current(), delayMs)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

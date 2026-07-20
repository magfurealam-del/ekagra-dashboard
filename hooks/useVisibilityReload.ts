'use client'
import { useEffect } from 'react'

/**
 * Re-runs `load` whenever the browser tab becomes visible again.
 * Browsers throttle/suspend background tabs, which can silently drop
 * Supabase WebSocket connections and kill in-flight fetches. Without
 * this hook, the page stays stale (or shows a timeout error) until the
 * user manually refreshes.
 *
 * A short delay lets the browser finish restoring network state before
 * the first fetch fires.
 */
export function useVisibilityReload(load: () => void, delayMs = 400) {
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        setTimeout(load, delayMs)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

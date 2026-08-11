import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'

type MetaAdOption = { label: string; value: string }

function windowKey() {
  const now = new Date()
  const dhaka = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }))
  if (dhaka.getHours() < 6) dhaka.setDate(dhaka.getDate() - 1)
  return `${dhaka.getFullYear()}-${String(dhaka.getMonth() + 1).padStart(2, '0')}-${String(dhaka.getDate()).padStart(2, '0')}`
}

function msUntilNextSixDhaka() {
  const now = new Date()
  const dhaka = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }))
  const next = new Date(dhaka)
  next.setHours(6, 0, 0, 0)
  if (dhaka >= next) next.setDate(next.getDate() + 1)
  return Math.max(1000, next.getTime() - dhaka.getTime())
}

// Reads the manually-maintained Ad ID list from public.meta_ad_options —
// managed in Settings > Marketing > Ad ID Options, no connection to the
// Meta Ads API or the meta_active_ads table.
export function useMetaAdOptions() {
  const { session } = useAuth()
  const [options, setOptions] = useState<MetaAdOption[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Wait for AuthContext to resolve a session before querying — this table
    // has no anon grant, so firing before the JWT is attached (e.g. during
    // initial session bootstrap or a token refresh) always fails with
    // "permission denied for table meta_ad_options".
    if (!session) return

    let cancelled = false
    const key = `meta-ad-options:v1:${windowKey()}`

    async function load() {
      try {
        const cached = JSON.parse(localStorage.getItem(key) || 'null')
        if (cached?.windowKey === windowKey()) {
          if (!cancelled) setOptions(cached.options || [])
          return
        }
      } catch {
        localStorage.removeItem(key)
      }

      const { data, error } = await supabase
        .from('meta_ad_options')
        .select('ad_id, campaign_name')
        .order('ad_id')

      if (error) {
        console.error('[meta-ad-options] failed to load public.meta_ad_options', error)
        return
      }

      const next = (data || []).map((row) => ({
        value: row.ad_id,
        label: row.campaign_name ? `${row.ad_id} — ${row.campaign_name}` : row.ad_id,
      }))
      localStorage.setItem(key, JSON.stringify({ windowKey: windowKey(), options: next }))
      if (!cancelled) setOptions(next)
    }

    load()
    const scheduleNextRefresh = () => {
      timer.current = setTimeout(async () => {
        await load()
        scheduleNextRefresh()
      }, msUntilNextSixDhaka())
    }
    scheduleNextRefresh()
    return () => {
      cancelled = true
      if (timer.current) clearTimeout(timer.current)
    }
  }, [session])

  return options
}

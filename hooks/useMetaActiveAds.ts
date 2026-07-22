import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

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

export function useMetaActiveAds() {
  const [options, setOptions] = useState<MetaAdOption[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    const key = `meta-active-ads:${windowKey()}`

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

      const { data } = await supabase
        .from('meta_active_ads')
        .select('ad_id, ad_name, campaign_name')
        .eq('is_current', true)
        .order('campaign_name')
        .order('ad_name')

      const next = (data || []).map((ad) => ({
        value: ad.ad_id,
        label: `${ad.campaign_name || 'Unnamed campaign'} · ${ad.ad_name || ad.ad_id}`,
      }))
      localStorage.setItem(key, JSON.stringify({ windowKey: windowKey(), options: next }))
      if (!cancelled) setOptions(next)
    }

    load()
    timer.current = setTimeout(load, msUntilNextSixDhaka())
    return () => {
      cancelled = true
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return options
}

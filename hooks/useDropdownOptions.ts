'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type DropdownOption = { label: string; value: string }

export function useDropdownOptions(category: string) {
  const [options, setOptions] = useState<DropdownOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    function load() {
      supabase
        .from('dropdown_options')
        .select('label, value')
        .eq('category', category)
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .then(({ data, error }) => {
          if (!active) return
          if (!error && data) setOptions(data)
          setLoading(false)
        })
    }

    load()

    const now = new Date()
    const next = new Date(now)
    next.setHours(6, 0, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    const interval = window.setTimeout(load, next.getTime() - now.getTime())

    return () => {
      active = false
      window.clearTimeout(interval)
    }
  }, [category])

  return { options, loading }
}

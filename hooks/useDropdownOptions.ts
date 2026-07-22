'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CRM_POLL_INTERVAL_MS } from '@/lib/polling'

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

    const interval = window.setInterval(load, CRM_POLL_INTERVAL_MS)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [category])

  return { options, loading }
}

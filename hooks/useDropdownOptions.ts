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

    let interval: number
    const scheduleNextRefresh = () => {
      const current = new Date()
      const target = new Date(current)
      target.setHours(6, 0, 0, 0)
      if (target <= current) target.setDate(target.getDate() + 1)
      interval = window.setTimeout(() => {
        load()
        scheduleNextRefresh()
      }, target.getTime() - current.getTime())
    }
    scheduleNextRefresh()

    return () => {
      active = false
      window.clearTimeout(interval)
    }
  }, [category])

  return { options, loading }
}

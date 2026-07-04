'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { subscribeDropdownOptionsChanges } from '@/lib/dropdownOptionsBus'

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

    setLoading(true)
    load()

    // Pick up changes made from Settings (add/remove/activate) without
    // requiring a page reload on whichever page is using this dropdown.
    // Uses one shared Realtime channel for the whole table instead of a
    // dedicated channel per category/hook instance.
    const unsubscribe = subscribeDropdownOptionsChanges((changedCategory) => {
      if (changedCategory === category) load()
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [category])

  return { options, loading }
}

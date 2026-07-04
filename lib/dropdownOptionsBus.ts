import { supabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

// Every useDropdownOptions() instance used to open its own Realtime channel
// (one per category, e.g. 9 on the Lead Intake page alone). Each channel is
// a distinct Postgres logical-replication subscription server-side, and on
// Supabase's free tier (60 connection cap) that adds up fast across agents
// with multiple tabs open all day, contributing to intermittent timeouts.
// This singleton opens ONE channel per browser tab for the whole
// dropdown_options table and fans changes out to every listener.

type Listener = (category: string) => void

let channel: RealtimeChannel | null = null
const listeners = new Set<Listener>()

function ensureChannel() {
  if (channel) return
  channel = supabase
    .channel('dropdown-options-shared')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dropdown_options' }, (payload) => {
      const category = (payload.new as any)?.category ?? (payload.old as any)?.category
      if (!category) return
      listeners.forEach((l) => l(category))
    })
    .subscribe()
}

export function subscribeDropdownOptionsChanges(listener: Listener): () => void {
  ensureChannel()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && channel) {
      supabase.removeChannel(channel)
      channel = null
    }
  }
}

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable')
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ekagra-auth' },
  realtime: {
    // Send a heartbeat every 15 s so the server knows the connection is alive.
    // Default is 30 s — on a flaky mobile connection the server may close the
    // socket before the next heartbeat, triggering a full reconnect cycle.
    heartbeatIntervalMs: 15000,
    // Reconnect after 2 s on the first attempt (default starts at ~1 s but
    // uses a random jitter that can push it much higher on later attempts).
    // Capping at 5 s means a tab that was backgrounded for hours reconnects
    // in at most 5 s instead of the default 30 s+ exponential backoff.
    reconnectAfterMs: (tries: number) => Math.min(2000 * (tries + 1), 5000),
    // Abort a channel subscription attempt after 10 s rather than waiting
    // indefinitely for a SUBSCRIBED confirmation from the server.
    timeout: 10000,
  },
})

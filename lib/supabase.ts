import { createClient } from '@supabase/supabase-js'

// NEXT_PUBLIC_ vars are baked in at build time.
// Hardcoded fallbacks ensure preview deployments work even when
// env vars are scoped to Production-only in Vercel.
// These are the PUBLIC anon key — not secret, safe to embed.
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL  || 'https://youqgrwovfyqqsnbtcnm.supabase.co'
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvdXFncndvdmZ5cXFzbmJ0Y25tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMzA1NjYsImV4cCI6MjA5NzYwNjU2Nn0.DDT_QztGEchnhdmOoC1ADH6chXYuZgk9MnxxExa93Vw'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)

/** Server-side admin client — uses service role key. Never call from browser code. */
export function getServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  return createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
}

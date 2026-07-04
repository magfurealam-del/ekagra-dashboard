import { createClient } from '@supabase/supabase-js'

// Fallback values are the public Supabase URL + anon key (safe to embed client-side;
// RLS policies, not secrecy, protect the data). This mirrors the pattern already used
// elsewhere in this project so preview builds work even when Vercel env vars aren't
// configured for a given branch/environment.
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://youqgrwovfyqqsnbtcnm.supabase.co'
const key =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvdXFncndvdmZ5cXFzbmJ0Y25tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMzA1NjYsImV4cCI6MjA5NzYwNjU2Nn0.DDT_QztGEchnhdmOoC1ADH6chXYuZgk9MnxxExa93Vw'

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ekagra-auth' },
})

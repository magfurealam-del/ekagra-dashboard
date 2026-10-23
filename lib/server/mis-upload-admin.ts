import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const BUCKET = 'mis-upload-source'

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing server configuration: ${name}`)
  return value
}

export function uploadsEnabled(): boolean {
  return process.env.MIS_UPLOADS_ENABLED === 'true'
}

export function getAdminSupabase(): SupabaseClient {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function requireActiveAdmin(request: Request): Promise<
  | { actorId: string; admin: SupabaseClient }
  | { response: NextResponse }
> {
  const authorization = request.headers.get('authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return { response: NextResponse.json({ error: 'Authentication required.' }, { status: 401 }) }

  const url = env('NEXT_PUBLIC_SUPABASE_URL')
  const anonKey = env('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  const authClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error: authError } = await authClient.auth.getUser(token)
  if (authError || !user) {
    return { response: NextResponse.json({ error: 'Session is invalid or expired.' }, { status: 401 }) }
  }

  const admin = getAdminSupabase()
  const { data: profile, error } = await admin
    .from('user_profiles')
    .select('id, role, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (error) {
    return { response: NextResponse.json({ error: 'Unable to verify administrator access.' }, { status: 503 }) }
  }
  if (profile?.role !== 'admin' || profile.is_active !== true) {
    return { response: NextResponse.json({ error: 'Active administrator access required.' }, { status: 403 }) }
  }
  return { actorId: user.id, admin }
}

export function jsonError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

export { BUCKET }

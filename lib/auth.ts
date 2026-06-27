import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export type UserRole = 'admin' | 'manager' | 'executive' | 'call_center_agent' | 'finance_viewer'

export interface UserProfile {
  id: string
  full_name: string | null
  email: string | null
  role: UserRole
  is_active: boolean
}

export const ROLE_NAV: Record<UserRole, { href: string; label: string; icon: string }[]> = {
  admin: [
    { href: '/dashboard', label: 'Executive Dashboard', icon: '📊' },
    { href: '/call-center', label: 'Call Center', icon: '📞' },
    { href: '/call-center/new', label: 'Add New Lead', icon: '➕' },
    { href: '/appointments', label: 'Appointments', icon: '📅' },
    { href: '/callbacks', label: 'Callback Queue', icon: '🔁' },
    { href: '/outbound-calls', label: 'Outbound Calls', icon: '📤' },
    { href: '/no-shows', label: 'No Shows', icon: '🚫' },
    { href: '/settings/dropdowns', label: 'Settings', icon: '⚙️' },
    { href: '/user-management', label: 'User Management', icon: '👥' },
  ],
  manager: [
    { href: '/dashboard', label: 'Executive Dashboard', icon: '📊' },
    { href: '/call-center', label: 'Call Center', icon: '📞' },
    { href: '/call-center/new', label: 'Add New Lead', icon: '➕' },
    { href: '/appointments', label: 'Appointments', icon: '📅' },
    { href: '/callbacks', label: 'Callback Queue', icon: '🔁' },
    { href: '/outbound-calls', label: 'Outbound Calls', icon: '📤' },
    { href: '/no-shows', label: 'No Shows', icon: '🚫' },
  ],
  call_center_agent: [
    { href: '/call-center/new', label: 'Add New Lead', icon: '➕' },
    { href: '/appointments', label: 'Appointments', icon: '📅' },
    { href: '/callbacks', label: 'Callback Queue', icon: '🔁' },
    { href: '/outbound-calls', label: 'Outbound Calls', icon: '📤' },
    { href: '/no-shows', label: 'No Shows', icon: '🚫' },
  ],
  executive: [
    { href: '/dashboard', label: 'Executive Dashboard', icon: '📊' },
  ],
  finance_viewer: [
    { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  ],
}

export async function getServerUser(): Promise<UserProfile | null> {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data } = await supabase.from('user_profiles').select('*').eq('id', user.id).single()
    if (data) return data as UserProfile
    // No profile row yet — return admin fallback so first user can set up
    return { id: user.id, full_name: user.email?.split('@')[0] || 'Admin', email: user.email || null, role: 'admin', is_active: true }
  } catch { return null }
}

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const PUBLIC = ['/login', '/api/health', '/favicon.ico', '/_next']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC.some(p => pathname.startsWith(p))) return NextResponse.next()

  const res = NextResponse.next()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(list) {
          list.forEach(({ name, value, options }) => {
            req.cookies.set(name, value)
            res.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const url = new URL('/login', req.url)
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  // If profile exists, enforce role-based access
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single()

  // No profile yet → treat as admin (first-time setup)
  if (!profile) return res
  if (!profile.is_active) return NextResponse.redirect(new URL('/login', req.url))

  const role = profile.role as string

  // Admin: full access
  if (role === 'admin') return res

  // Role restrictions
  const AGENT_ONLY = ['/call-center/new', '/appointments', '/callbacks', '/outbound-calls', '/no-shows']
  const EXEC_ONLY = ['/dashboard']
  const MANAGER_ALLOWED = ['/dashboard', '/call-center', '/appointments', '/callbacks', '/outbound-calls', '/no-shows']

  if (role === 'executive' && !EXEC_ONLY.some(p => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }
  if (role === 'finance_viewer' && !EXEC_ONLY.some(p => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }
  if (role === 'call_center_agent' && !AGENT_ONLY.some(p => pathname.startsWith(p)) && !pathname.startsWith('/api/')) {
    return NextResponse.redirect(new URL('/call-center/new', req.url))
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

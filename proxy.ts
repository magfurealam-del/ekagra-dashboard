import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const PUBLIC = ['/login', '/api/health', '/favicon.ico', '/_next']

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL  || 'https://youqgrwovfyqqsnbtcnm.supabase.co'
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvdXFncndvdmZ5cXFzbmJ0Y25tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMzA1NjYsImV4cCI6MjA5NzYwNjU2Nn0.DDT_QztGEchnhdmOoC1ADH6chXYuZgk9MnxxExa93Vw'

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC.some(p => pathname.startsWith(p))) return NextResponse.next()

  const res = NextResponse.next()
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      getAll() { return req.cookies.getAll() },
      setAll(list) {
        list.forEach(({ name, value, options }) => {
          req.cookies.set(name, value)
          res.cookies.set(name, value, options)
        })
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const url = new URL('/login', req.url)
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single()

  if (!profile) return res
  if (!profile.is_active) return NextResponse.redirect(new URL('/login', req.url))

  const role = profile.role as string
  if (role === 'admin') return res

  const AGENT_ONLY = ['/call-center/new', '/appointments', '/callbacks', '/outbound-calls', '/no-shows']
  const EXEC_ONLY  = ['/dashboard']

  if ((role === 'executive' || role === 'finance_viewer') && !EXEC_ONLY.some(p => pathname.startsWith(p))) {
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

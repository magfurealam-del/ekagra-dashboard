'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export type UserProfile = {
  id: string
  full_name: string | null
  email: string | null
  role: 'admin' | 'call_center_agent' | string
  is_active: boolean
  must_change_password: boolean
}

type AuthState = {
  session: Session | null
  profile: UserProfile | null
  loading: boolean
  isAdmin: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  isAdmin: false,
  signOut: async () => {},
})

// Routes reachable without a logged-in session
const PUBLIC_ROUTES = ['/login']

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const profileUserId = useRef<string | null>(null)
  const router = useRouter()
  const pathname = usePathname()

  async function loadProfile(userId: string) {
    if (profileUserId.current === userId && profile) return
    profileUserId.current = userId
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, full_name, email, role, is_active, must_change_password')
      .eq('id', userId)
      .single()
    if (error) {
      profileUserId.current = null
      setProfile(null)
      throw error
    }
    setProfile(data as UserProfile)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        setSession(null)
        setProfile(null)
        setLoading(false)
        return
      }
      setSession(data.session)
      if (data.session) {
        loadProfile(data.session.user.id).catch(() => {
          setSession(null)
          setProfile(null)
          router.replace('/login')
        }).finally(() => setLoading(false))
      } else setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (newSession) {
        loadProfile(newSession.user.id).catch(() => {})
      } else {
        profileUserId.current = null
        setProfile(null)
      }
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  // Client-side route guard — every page in this app fetches its own data
  // client-side via RLS-protected Supabase calls, so real enforcement lives
  // at the database layer; this just keeps unauthenticated users out of the
  // page shell and bounces them to /login.
  useEffect(() => {
    if (loading) return
    const isPublic = PUBLIC_ROUTES.includes(pathname)
    if (!session && !isPublic) {
      router.replace('/login')
    } else if (session && profile?.must_change_password && pathname !== '/change-password') {
      router.replace('/change-password')
    } else if (session && isPublic) {
      router.replace('/')
    }
  }, [loading, session, profile, pathname, router])

  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, isAdmin: profile?.role === 'admin', signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/AuthContext'
import { WorkspaceNavigation } from '@/components/WorkspaceNavigation'

export default function Nav() {
  const pathname = usePathname()
  const { session, profile, isAdmin, signOut } = useAuth()
  if (!session || pathname === '/login' || pathname === '/change-password')
    return null
  return (
    <WorkspaceNavigation
      pathname={pathname}
      isAdmin={isAdmin}
      name={profile?.full_name || profile?.email || 'Account'}
      role={profile?.role || 'Staff'}
      signOut={signOut}
      LinkComponent={Link}
    />
  )
}

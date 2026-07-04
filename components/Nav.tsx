'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/AuthContext'

const links = [
  { href: '/', label: 'Lead Intake & Appointment' },
  { href: '/patients', label: 'Patient List' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/outgoing-calls', label: 'Outgoing Call Sheet' },
  { href: '/settings', label: 'Settings', adminOnly: true },
]

export default function Nav() {
  const pathname = usePathname()
  const { session, profile, isAdmin, signOut } = useAuth()

  // Hide the whole nav chrome on the login/change-password screens
  if (!session || pathname === '/login' || pathname === '/change-password') return null

  return (
    <nav className="border-b border-slate-200 bg-white sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center gap-1 overflow-x-auto py-2">
          <span className="font-semibold text-slate-800 pr-4 whitespace-nowrap">Ekagra Call Center</span>
          {links.filter(l => !l.adminOnly || isAdmin).map((l) => {
            const active = pathname === l.href
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  active ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {l.label}
              </Link>
            )
          })}
          <div className="ml-auto flex items-center gap-3 pl-4 whitespace-nowrap">
            <span className="text-sm text-slate-500">
              {profile?.full_name || profile?.email}
              {profile?.role && <span className="ml-1.5 text-xs rounded-full bg-slate-100 text-slate-500 px-2 py-0.5">{profile.role.replace(/_/g, ' ')}</span>}
            </span>
            <button onClick={signOut} className="text-sm text-slate-500 hover:text-rose-600">Sign out</button>
          </div>
        </div>
      </div>
    </nav>
  )
}

'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/', label: 'Lead Intake & Appointment' },
  { href: '/today', label: "Today's Appointments" },
  { href: '/patients', label: 'Patient List' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/followups', label: 'No-Shows & Follow-ups' },
  { href: '/outgoing-calls', label: 'Outgoing Call Sheet' },
  { href: '/settings', label: 'Settings' },
]

export default function Nav() {
  const pathname = usePathname()
  return (
    <nav className="border-b border-slate-200 bg-white sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center gap-1 overflow-x-auto py-2">
          <span className="font-semibold text-slate-800 pr-4 whitespace-nowrap">Ekagra Call Center</span>
          {links.map((l) => {
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
        </div>
      </div>
    </nav>
  )
}

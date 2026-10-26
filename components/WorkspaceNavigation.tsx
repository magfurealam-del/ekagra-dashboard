'use client'
import { useState, type ComponentType, type ReactNode } from 'react'
import {
  BarChart3,
  CalendarDays,
  CalendarClock,
  ClipboardPlus,
  FileUp,
  LayoutDashboard,
  LogOut,
  Menu,
  PhoneOutgoing,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

type NavLinkProps = {
  href: string
  children: ReactNode
  className?: string
  onClick?: () => void
  'aria-current'?: 'page'
}
const groups: {
  label: string
  adminOnly?: boolean
  links: { href: string; label: string; icon: LucideIcon }[]
}[] = [
  {
    label: 'Intelligence',
    adminOnly: true,
    links: [
      {
        href: '/admin-dashboard',
        label: 'Executive dashboard',
        icon: LayoutDashboard,
      },
    ],
  },
  {
    label: 'Daily operations',
    links: [
      { href: '/', label: 'Lead intake', icon: ClipboardPlus },
      { href: '/patients', label: 'Patients', icon: Users },
      { href: '/calendar', label: 'Appointments', icon: CalendarDays },
      { href: '/outgoing-calls', label: 'Outbound calls', icon: PhoneOutgoing },
      {
        href: '/doctor-availability',
        label: 'Doctor availability',
        icon: CalendarClock,
      },
      { href: '/call-kpis', label: 'Call performance', icon: BarChart3 },
    ],
  },
  {
    label: 'Administration',
    adminOnly: true,
    links: [
      { href: '/admin/mis-upload', label: 'MIS imports', icon: FileUp },
      {
        href: '/admin/marketing-review',
        label: 'Attribution review',
        icon: ShieldCheck,
      },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]
function Anchor(props: NavLinkProps) {
  return <a {...props} />
}
export function WorkspaceNavigation({
  pathname,
  isAdmin,
  name,
  role,
  signOut,
  LinkComponent = Anchor,
}: {
  pathname: string
  isAdmin: boolean
  name: string
  role: string
  signOut: () => void
  LinkComponent?: ComponentType<NavLinkProps>
}) {
  const [open, setOpen] = useState(false)
  const navigation = (
    <>
      <div className="px-5 pb-7 pt-7">
        <div className="text-[24px] font-semibold tracking-[-1px] text-slate-900">
          ekagra<span className="text-teal-700">.</span>
        </div>
        <div className="mt-1 text-xs font-medium tracking-wide text-slate-500">
          CALL CENTER · DHANMONDI
        </div>
      </div>
      <nav
        aria-label="Main navigation"
        className="flex-1 space-y-7 overflow-y-auto px-3"
      >
        {groups
          .filter((group) => !group.adminOnly || isAdmin)
          .map((group) => (
            <div key={group.label}>
              <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.links.map(({ href, label, icon: Icon }) => {
                  const active =
                    pathname === href ||
                    (href !== '/' && pathname.startsWith(`${href}/`))
                  return (
                    <LinkComponent
                      key={href}
                      href={href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-teal-50 text-teal-800'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                      )}
                    >
                      <Icon
                        className="size-[18px] shrink-0"
                        aria-hidden="true"
                      />
                      {label}
                    </LinkComponent>
                  )
                })}
              </div>
            </div>
          ))}
      </nav>
      <div className="mt-6 flex items-center gap-3 border-t p-4">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600"
          aria-hidden="true"
        >
          {name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-xs capitalize text-slate-500">
            {role.replace(/_/g, ' ')}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={signOut}
          aria-label="Sign out"
        >
          <LogOut />
        </Button>
      </div>
    </>
  )
  return (
    <>
      <a
        className="sr-only fixed left-3 top-3 z-[100] rounded-md bg-white px-4 py-3 text-teal-800 shadow focus:not-sr-only"
        href="#main-content"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-white lg:flex">
        {navigation}
      </aside>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-white px-4 lg:hidden">
        <span className="font-semibold">Ekagra Call Center</span>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="h-11 gap-2">
              <Menu />
              Menu
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 gap-0 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Workspace navigation</SheetTitle>
              <SheetDescription>
                Executive insights and call-center operations
              </SheetDescription>
            </SheetHeader>
            {navigation}
          </SheetContent>
        </Sheet>
      </header>
    </>
  )
}

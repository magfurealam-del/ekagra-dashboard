import type { UserRole } from "@/types"

export { UserRole }

export const ROLE_NAV: Record<UserRole, { href: string; label: string; icon: string }[]> = {
  admin: [
    { href: "/dashboard", label: "Dashboard", icon: "📊" },
    { href: "/call-center", label: "Call Center", icon: "📞" },
    { href: "/call-center/new", label: "+ New Lead", icon: "➕" },
    { href: "/appointments", label: "Appointments", icon: "📅" },
    { href: "/callbacks", label: "Callbacks", icon: "🔁" },
    { href: "/outbound-calls", label: "Outbound", icon: "📤" },
    { href: "/no-shows", label: "No Shows", icon: "🚫" },
    { href: "/settings/dropdowns", label: "Settings", icon: "⚙️" },
    { href: "/user-management", label: "Users", icon: "👥" },
  ],
  manager: [
    { href: "/dashboard", label: "Dashboard", icon: "📊" },
    { href: "/call-center", label: "Call Center", icon: "📞" },
    { href: "/call-center/new", label: "+ New Lead", icon: "➕" },
    { href: "/appointments", label: "Appointments", icon: "📅" },
    { href: "/callbacks", label: "Callbacks", icon: "🔁" },
    { href: "/outbound-calls", label: "Outbound", icon: "📤" },
    { href: "/no-shows", label: "No Shows", icon: "🚫" },
  ],
  call_center_agent: [
    { href: "/call-center/new", label: "+ New Lead", icon: "➕" },
    { href: "/appointments", label: "Appointments", icon: "📅" },
    { href: "/callbacks", label: "Callbacks", icon: "🔁" },
    { href: "/outbound-calls", label: "Outbound", icon: "📤" },
    { href: "/no-shows", label: "No Shows", icon: "🚫" },
  ],
  executive: [{ href: "/dashboard", label: "Dashboard", icon: "📊" }],
  finance_viewer: [{ href: "/dashboard", label: "Dashboard", icon: "📊" }],
}

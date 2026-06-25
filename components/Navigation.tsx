"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/call-center", label: "Call Center", icon: "📞" },
  { href: "/call-center/new", label: "+ New Lead", icon: "➕" },
  { href: "/outbound-calls", label: "Outbound", icon: "📤" },
  { href: "/no-shows", label: "No Shows", icon: "🚫" },
  { href: "/callbacks", label: "Callbacks", icon: "🔁" },
  { href: "/appointments", label: "Appointments", icon: "📅" },
  { href: "/settings/dropdowns", label: "Settings", icon: "⚙️" },
];

export default function Navigation() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-screen-2xl mx-auto px-4">
        <div className="flex items-center gap-1 h-14 overflow-x-auto">
          <div className="flex items-center gap-2 mr-4 pr-4 border-r border-gray-200 shrink-0">
            <span className="text-lg">🏥</span>
            <span className="font-semibold text-gray-900 text-sm">Ekagra Health</span>
          </div>
          {navItems.map((item) => {
            const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href) && item.href !== "/call-center/new");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

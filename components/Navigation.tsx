"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { UserRole } from "@/types";

const ALL_NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "📊", roles: ["admin","manager","executive","finance_viewer"] },
  { href: "/call-center", label: "Call Center", icon: "📞", roles: ["admin","manager"] },
  { href: "/call-center/new", label: "+ New Lead", icon: "➕", roles: ["admin","manager","call_center_agent"] },
  { href: "/appointments", label: "Appointments", icon: "📅", roles: ["admin","manager","call_center_agent"] },
  { href: "/callbacks", label: "Callbacks", icon: "🔁", roles: ["admin","manager","call_center_agent"] },
  { href: "/outbound-calls", label: "Outbound", icon: "📤", roles: ["admin","manager","call_center_agent"] },
  { href: "/no-shows", label: "No Shows", icon: "🚫", roles: ["admin","manager","call_center_agent"] },
  { href: "/settings/dropdowns", label: "Settings", icon: "⚙️", roles: ["admin"] },
  { href: "/user-management", label: "Users", icon: "👥", roles: ["admin"] },
];

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setEmail(user.email || null);
      const { data } = await supabase.from("user_profiles").select("role").eq("id", user.id).single();
      setRole((data?.role as UserRole) || "admin");
    });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (pathname === "/login") return null;

  const visibleNav = role
    ? ALL_NAV.filter(n => n.roles.includes(role))
    : ALL_NAV;

  return (
    <nav className="bg-slate-900 text-white sticky top-0 z-50 shadow-lg">
      <div className="max-w-screen-2xl mx-auto px-4">
        <div className="flex items-center h-14 gap-1">
          {/* Logo */}
          <div className="flex items-center gap-2 mr-4 pr-4 border-r border-slate-700 shrink-0">
            <div className="w-7 h-7 bg-teal-500 rounded-lg flex items-center justify-center text-xs font-bold">EH</div>
            <span className="font-semibold text-sm">Ekagra Health</span>
          </div>

          {/* Nav items - scrollable */}
          <div className="flex items-center gap-0.5 overflow-x-auto flex-1 scrollbar-hide">
            {visibleNav.map((item) => {
              const active = pathname === item.href ||
                (item.href !== "/dashboard" && item.href !== "/call-center/new" && pathname.startsWith(item.href));
              return (
                <Link key={item.href} href={item.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                    active ? "bg-teal-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  }`}>
                  <span>{item.icon}</span>{item.label}
                </Link>
              );
            })}
          </div>

          {/* User menu */}
          {email && (
            <div className="relative ml-2 shrink-0">
              <button onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md text-slate-300 hover:bg-slate-800 text-sm">
                <span className="hidden sm:block max-w-32 truncate">{email.split("@")[0]}</span>
                <span className="text-xs bg-teal-700 px-1.5 py-0.5 rounded capitalize">
                  {role?.replace("_", " ") || "…"}
                </span>
                <span className="text-xs">▾</span>
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-40 z-50">
                  <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100 truncate">{email}</div>
                  <button onClick={handleSignOut}
                    className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

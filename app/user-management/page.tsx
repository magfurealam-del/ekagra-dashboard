"use client";
import { useState, useEffect } from "react";
import type { UserProfile, UserRole } from "@/types";

const ROLES: { value: UserRole; label: string; desc: string }[] = [
  { value: "admin", label: "Admin", desc: "Full access — all pages and settings" },
  { value: "manager", label: "Manager", desc: "Dashboard, call center, callbacks, no-shows" },
  { value: "executive", label: "Executive", desc: "Read-only executive dashboard" },
  { value: "call_center_agent", label: "Agent", desc: "Add leads, callbacks, outbound, no-shows" },
  { value: "finance_viewer", label: "Finance", desc: "Revenue dashboards only" },
];

const ROLE_BADGE: Record<UserRole, string> = {
  admin: "bg-purple-100 text-purple-700",
  manager: "bg-blue-100 text-blue-700",
  executive: "bg-indigo-100 text-indigo-700",
  call_center_agent: "bg-teal-100 text-teal-700",
  finance_viewer: "bg-amber-100 text-amber-700",
};

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [flash, setFlash] = useState("");

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/users");
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const update = async (id: string, updates: Partial<UserProfile>) => {
    setUpdating(id);
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      setFlash("Saved ✓");
      setTimeout(() => setFlash(""), 2000);
      load();
    }
    setUpdating(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-500">Manage staff access and roles</p>
        </div>
        {flash && <div className="text-sm text-green-600 font-medium">{flash}</div>}
      </div>

      {/* Role guide */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Role Permissions</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {ROLES.map(r => (
            <div key={r.value} className="flex items-start gap-2 p-3 bg-gray-50 rounded-xl">
              <span className={`text-xs px-2 py-0.5 rounded-lg font-medium shrink-0 ${ROLE_BADGE[r.value]}`}>{r.label}</span>
              <span className="text-xs text-gray-600">{r.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Users list */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Staff Accounts</h2>
          <span className="text-xs text-gray-400">{users.length} users</span>
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            {Array(4).fill(0).map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
        ) : users.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            <div className="text-4xl mb-3">👥</div>
            <div className="font-medium">No users yet</div>
            <div className="text-sm mt-1">Users appear here after their first sign-in</div>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {users.map(u => (
              <div key={u.id} className={`flex items-center gap-4 px-5 py-4 ${!u.is_active ? "opacity-50" : ""}`}>
                <div className="w-9 h-9 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center font-semibold text-sm shrink-0">
                  {(u.full_name || u.email || "?")[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-800 truncate">{u.full_name || "No name"}</div>
                  <div className="text-xs text-gray-500 truncate">{u.email}</div>
                </div>
                <select value={u.role} onChange={e => update(u.id, { role: e.target.value as UserRole })}
                  disabled={updating === u.id}
                  className="border border-gray-300 rounded-xl px-2 py-1.5 text-sm disabled:opacity-60">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <button onClick={() => update(u.id, { is_active: !u.is_active })}
                  disabled={updating === u.id}
                  className={`px-3 py-1.5 text-xs rounded-xl border transition-colors disabled:opacity-60 ${
                    u.is_active ? "border-red-200 text-red-600 hover:bg-red-50" : "border-green-200 text-green-600 hover:bg-green-50"
                  }`}>
                  {updating === u.id ? "…" : u.is_active ? "Disable" : "Enable"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <strong>Setup note:</strong> New users are automatically assigned the <code className="bg-amber-100 px-1 rounded">call_center_agent</code> role on first sign-in. Promote them here after their first login.
      </div>
    </div>
  );
}

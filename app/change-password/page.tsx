'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'

export default function ChangePasswordPage() {
  const { session, profile } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }

    setSaving(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) { setSaving(false); setError(updateError.message); return }

    if (session) {
      await supabase.from('user_profiles').update({ must_change_password: false }).eq('id', session.user.id)
    }
    setSaving(false)
    window.location.href = '/'
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-8 w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Set a new password</h1>
          <p className="text-sm text-slate-500">
            {profile?.full_name ? `Welcome, ${profile.full_name}. ` : ''}
            This is your first sign-in — choose a password only you know.
          </p>
        </div>

        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">New password</span>
          <input type="password" required minLength={8} className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Confirm new password</span>
          <input type="password" required minLength={8} className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <button type="submit" disabled={saving} className="w-full bg-teal-600 text-white py-2.5 rounded-md text-sm font-medium disabled:opacity-50">
          {saving ? 'Saving…' : 'Set password and continue'}
        </button>
      </form>
    </div>
  )
}

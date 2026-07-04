'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) { setError('Invalid email or password.'); return }
    window.location.href = '/'
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-8 w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Ekagra Call Center</h1>
          <p className="text-sm text-slate-500">Sign in to continue</p>
        </div>

        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Email</span>
          <input
            type="email"
            required
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Password</span>
          <input
            type="password"
            required
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-teal-600 text-white py-2.5 rounded-md text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

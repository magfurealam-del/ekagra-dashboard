'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { withRetry } from '@/lib/withTimeout'

type MetaAdOption = {
  id: number
  ad_id: string
  campaign_name: string | null
}

export default function MetaAdOptionsEditor({ showToast }: { showToast: (message: string) => void }) {
  const [options, setOptions] = useState<MetaAdOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newAdId, setNewAdId] = useState('')
  const [newCampaignName, setNewCampaignName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editAdId, setEditAdId] = useState('')
  const [editCampaignName, setEditCampaignName] = useState('')

  async function load() {
    const res = await withRetry(
      () => supabase.from('meta_ad_options').select('id, ad_id, campaign_name').order('ad_id'),
      15000,
      2,
    )
    if (res?.error) showToast(`Could not load ad IDs: ${res.error.message}`)
    setOptions((res?.data || []) as MetaAdOption[])
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addOption() {
    if (!newAdId.trim()) { showToast('Ad ID is required.'); return }
    setSaving(true)
    const { error } = await supabase
      .from('meta_ad_options')
      .insert({ ad_id: newAdId.trim(), campaign_name: newCampaignName.trim() || null })
    setSaving(false)
    if (error) {
      const duplicate = error.code === '23505'
      showToast(duplicate ? 'That Ad ID already exists.' : `Save failed: ${error.message}`)
      return
    }
    setNewAdId('')
    setNewCampaignName('')
    showToast('Ad ID added.')
    load()
  }

  function startEdit(option: MetaAdOption) {
    setEditingId(option.id)
    setEditAdId(option.ad_id)
    setEditCampaignName(option.campaign_name || '')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditAdId('')
    setEditCampaignName('')
  }

  async function saveEdit() {
    if (!editAdId.trim()) { showToast('Ad ID is required.'); return }
    setSaving(true)
    const { error } = await supabase
      .from('meta_ad_options')
      .update({ ad_id: editAdId.trim(), campaign_name: editCampaignName.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', editingId)
    setSaving(false)
    if (error) {
      const duplicate = error.code === '23505'
      showToast(duplicate ? 'That Ad ID already exists.' : `Save failed: ${error.message}`)
      return
    }
    showToast('Ad ID updated.')
    cancelEdit()
    load()
  }

  async function removeOption(option: MetaAdOption) {
    if (!confirm(`Remove Ad ID "${option.ad_id}"?`)) return
    const { error } = await supabase.from('meta_ad_options').delete().eq('id', option.id)
    if (error) {
      showToast(`Delete failed: ${error.message}`)
      return
    }
    showToast('Ad ID removed.')
    load()
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
      <div>
        <h2 className="font-medium text-slate-700">Ad ID Options</h2>
        <p className="text-xs text-slate-500 mt-1">
          The Ad ID list shown on the Lead Intake form. Fully manual — no connection to the Meta Ads API.
        </p>
      </div>

      <ul className="divide-y divide-slate-100">
        {options.map((option) => (
          <li key={option.id} className="py-2">
            {editingId === option.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <input className="input flex-1 min-w-[140px]" value={editAdId} onChange={(e) => setEditAdId(e.target.value)} placeholder="Ad ID" />
                <input className="input flex-1 min-w-[140px]" value={editCampaignName} onChange={(e) => setEditCampaignName(e.target.value)} placeholder="Campaign name" />
                <button onClick={saveEdit} disabled={saving} className="text-xs px-3 py-1.5 rounded-md bg-teal-600 text-white font-medium disabled:opacity-60">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={cancelEdit} disabled={saving} className="text-xs px-3 py-1.5 rounded-md border border-slate-300 text-slate-600">
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-mono">{option.ad_id}</span>
                  {option.campaign_name && <span className="text-slate-400"> — {option.campaign_name}</span>}
                </span>
                <span className="flex gap-3">
                  <button onClick={() => startEdit(option)} className="text-xs text-teal-700">Edit</button>
                  <button onClick={() => removeOption(option)} className="text-xs text-rose-600">Remove</button>
                </span>
              </div>
            )}
          </li>
        ))}
        {!loading && options.length === 0 && <li className="py-2 text-sm text-slate-400">No ad IDs yet.</li>}
        {loading && <li className="py-2 text-sm text-slate-400">Loading…</li>}
      </ul>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
        <input className="input flex-1 min-w-[140px]" placeholder="Ad ID" value={newAdId} onChange={(e) => setNewAdId(e.target.value)} />
        <input className="input flex-1 min-w-[140px]" placeholder="Campaign name (optional)" value={newCampaignName} onChange={(e) => setNewCampaignName(e.target.value)} />
        <button onClick={addOption} disabled={saving} className="bg-teal-600 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-60">
          Add
        </button>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { withRetry } from '@/lib/withTimeout'

type MetaAd = {
  id: number
  ad_account_id: string
  ad_account_name: string | null
  campaign_id: string | null
  campaign_name: string | null
  ad_id: string
  ad_name: string | null
  campaign_effective_status: string
  ad_effective_status: string
  checked_at: string
  is_current: boolean
  is_enabled: boolean
  is_manual: boolean
  spend_amount: number | string | null
  spend_currency: string | null
  spend_date: string | null
}

type AdForm = {
  ad_account_id: string
  ad_account_name: string
  campaign_id: string
  campaign_name: string
  ad_id: string
  ad_name: string
  campaign_effective_status: string
  ad_effective_status: string
  is_current: boolean
  is_enabled: boolean
}

const EMPTY_FORM: AdForm = {
  ad_account_id: '',
  ad_account_name: '',
  campaign_id: '',
  campaign_name: '',
  ad_id: '',
  ad_name: '',
  campaign_effective_status: 'ACTIVE',
  ad_effective_status: 'ACTIVE',
  is_current: true,
  is_enabled: true,
}

const STATUS_OPTIONS = ['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED', 'IN_PROCESS', 'WITH_ISSUES']

function formFromRow(row: MetaAd): AdForm {
  return {
    ad_account_id: row.ad_account_id,
    ad_account_name: row.ad_account_name || '',
    campaign_id: row.campaign_id || '',
    campaign_name: row.campaign_name || '',
    ad_id: row.ad_id,
    ad_name: row.ad_name || '',
    campaign_effective_status: row.campaign_effective_status,
    ad_effective_status: row.ad_effective_status,
    is_current: row.is_current,
    is_enabled: row.is_enabled,
  }
}

function nullable(value: string) {
  const trimmed = value.trim()
  return trimmed || null
}

// Both columns are NOT NULL in the database, so a blank value gets a
// manual placeholder instead of blocking the save — there is no format
// requirement on manual entries anymore (no live Meta API to validate against).
function withPlaceholder(value: string, prefix: string) {
  const trimmed = value.trim()
  return trimmed || `manual-${prefix}-${Date.now()}`
}

export default function MetaAdsEditor({ showToast }: { showToast: (message: string) => void }) {
  const [ads, setAds] = useState<MetaAd[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<AdForm>(EMPTY_FORM)

  async function loadAds() {
    const res = await withRetry(
      () => supabase
        .from('meta_active_ads')
        .select('id, ad_account_id, ad_account_name, campaign_id, campaign_name, ad_id, ad_name, campaign_effective_status, ad_effective_status, checked_at, is_current, is_enabled, is_manual, spend_amount, spend_currency, spend_date')
        .order('is_current', { ascending: false })
        .order('campaign_name')
        .order('ad_name'),
      15000,
      2,
    )
    if (res?.error) showToast(`Could not load Meta ads: ${res.error.message}`)
    setAds((res?.data || []) as MetaAd[])
    setLoading(false)
  }

  useEffect(() => {
    // This effect synchronizes the editor with the external Supabase table.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAds()
    // The initial load must run once; later refreshes are explicit after mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visibleAds = useMemo(() => {
    const query = search.trim().toLowerCase()
    return ads.filter((ad) => {
      if (!showAll && !ad.is_current) return false
      if (!query) return true
      return [
        ad.ad_account_id,
        ad.ad_account_name,
        ad.campaign_id,
        ad.campaign_name,
        ad.ad_id,
        ad.ad_name,
      ].some((value) => value?.toLowerCase().includes(query))
    })
  }, [ads, search, showAll])

  function startAdd() {
    const defaultAccount = ads.find((ad) => ad.is_current) || ads[0]
    setEditingId(null)
    setAdding(true)
    setForm({
      ...EMPTY_FORM,
      ad_account_id: defaultAccount?.ad_account_id || '',
      ad_account_name: defaultAccount?.ad_account_name || '',
    })
  }

  function startEdit(ad: MetaAd) {
    setAdding(false)
    setEditingId(ad.id)
    setForm(formFromRow(ad))
  }

  function closeForm() {
    setAdding(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  function setField<K extends keyof AdForm>(key: K, value: AdForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function saveAd() {
    setSaving(true)
    const payload = {
      ad_account_id: withPlaceholder(form.ad_account_id, 'account'),
      ad_account_name: nullable(form.ad_account_name),
      campaign_id: nullable(form.campaign_id),
      campaign_name: nullable(form.campaign_name),
      ad_id: withPlaceholder(form.ad_id, 'ad'),
      ad_name: nullable(form.ad_name),
      campaign_effective_status: form.campaign_effective_status,
      ad_effective_status: form.ad_effective_status,
      is_current: form.is_current,
      is_enabled: form.is_enabled,
      checked_at: new Date().toISOString(),
    }

    const result = adding
      ? await supabase.from('meta_active_ads').insert({ ...payload, is_manual: true }).select('id').single()
      : await supabase.from('meta_active_ads').update(payload).eq('id', editingId).select('id').single()

    setSaving(false)
    if (result.error) {
      const duplicate = result.error.code === '23505'
      showToast(duplicate ? 'That ad account and Ad ID already exist.' : `Save failed: ${result.error.message}`)
      return
    }

    showToast(adding ? 'Manual Meta ad added.' : 'Meta ad updated.')
    closeForm()
    loadAds()
  }

  async function toggleEnabled(ad: MetaAd) {
    const { error } = await supabase
      .from('meta_active_ads')
      .update({ is_enabled: !ad.is_enabled, checked_at: new Date().toISOString() })
      .eq('id', ad.id)

    if (error) {
      showToast(`Update failed: ${error.message}`)
      return
    }
    showToast(ad.is_enabled ? 'Ad disabled for selection.' : 'Ad enabled for selection.')
    loadAds()
  }

  async function deleteManualAd(ad: MetaAd) {
    if (!ad.is_manual || !confirm(`Delete manual ad "${ad.ad_name || ad.ad_id}"?`)) return
    const { error } = await supabase.from('meta_active_ads').delete().eq('id', ad.id).eq('is_manual', true)
    if (error) {
      showToast(`Delete failed: ${error.message}`)
      return
    }
    showToast('Manual Meta ad deleted.')
    loadAds()
  }

  const formOpen = adding || editingId !== null

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium text-slate-700">Meta Ads</h2>
            <p className="text-xs text-slate-500 mt-1">
              Edit the campaign and ad fields used for lead attribution. Tokens and Meta credentials are not stored here.
            </p>
          </div>
          <button
            type="button"
            onClick={startAdd}
            className="bg-teal-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-teal-700"
          >
            Add manual ad
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            className="input flex-1"
            placeholder="Search campaign, ad name, or ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-slate-600 whitespace-nowrap">
            <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
            Show previous ads
          </label>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded-full bg-teal-50 text-teal-700">
            {ads.filter((ad) => ad.is_current).length} current
          </span>
          <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-600">
            {ads.filter((ad) => ad.is_manual).length} manual
          </span>
          <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700">
            {ads.filter((ad) => !ad.is_enabled).length} disabled
          </span>
        </div>
      </div>

      {formOpen && (
        <div className="bg-white rounded-xl border border-teal-200 p-4 space-y-4">
          <div>
            <h3 className="font-medium text-slate-700">{adding ? 'Add manual Meta ad' : 'Edit Meta ad fields'}</h3>
            <p className="text-xs text-slate-500 mt-1">
              Any text is accepted — leave Ad account ID or Ad ID blank and a placeholder is generated automatically. Spend fields remain read-only because they come from Meta reporting.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Field label="Ad account ID" value={form.ad_account_id} onChange={(value) => setField('ad_account_id', value)} />
            <Field label="Ad account name" value={form.ad_account_name} onChange={(value) => setField('ad_account_name', value)} />
            <Field label="Campaign ID" value={form.campaign_id} onChange={(value) => setField('campaign_id', value)} />
            <Field label="Campaign name" value={form.campaign_name} onChange={(value) => setField('campaign_name', value)} />
            <Field label="Ad ID" value={form.ad_id} onChange={(value) => setField('ad_id', value)} />
            <Field label="Ad name" value={form.ad_name} onChange={(value) => setField('ad_name', value)} />
            <StatusField label="Campaign status" value={form.campaign_effective_status} onChange={(value) => setField('campaign_effective_status', value)} />
            <StatusField label="Ad status" value={form.ad_effective_status} onChange={(value) => setField('ad_effective_status', value)} />
          </div>

          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.is_current} onChange={(event) => setField('is_current', event.target.checked)} />
              Current ad
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.is_enabled} onChange={(event) => setField('is_enabled', event.target.checked)} />
              Enabled for selection
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={closeForm} disabled={saving} className="px-3 py-2 rounded-md text-sm text-slate-600 border border-slate-300">
              Cancel
            </button>
            <button type="button" onClick={saveAd} disabled={saving} className="px-4 py-2 rounded-md text-sm font-medium bg-teal-600 text-white disabled:opacity-60">
              {saving ? 'Saving…' : 'Save Meta ad'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[920px]">
            <thead className="text-xs text-slate-400 uppercase bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2">Campaign</th>
                <th className="text-left px-3 py-2">Ad</th>
                <th className="text-left px-3 py-2">Account</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Spend</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleAds.map((ad) => (
                <tr key={ad.id} className={!ad.is_enabled ? 'bg-slate-50 text-slate-500' : ''}>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-slate-700">{ad.campaign_name || 'Unnamed campaign'}</div>
                    <div className="text-xs text-slate-400 font-mono">{ad.campaign_id || 'No campaign ID'}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-slate-700">{ad.ad_name || 'Unnamed ad'}</div>
                    <div className="text-xs text-slate-400 font-mono">{ad.ad_id}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div>{ad.ad_account_name || 'Unnamed account'}</div>
                    <div className="text-xs text-slate-400 font-mono">{ad.ad_account_id}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge active={ad.ad_effective_status === 'ACTIVE'}>{ad.ad_effective_status}</StatusBadge>
                      {ad.is_manual && <StatusBadge active>Manual</StatusBadge>}
                      {!ad.is_enabled && <StatusBadge active={false}>Disabled</StatusBadge>}
                      {!ad.is_current && <StatusBadge active={false}>Previous</StatusBadge>}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top whitespace-nowrap">
                    {ad.spend_amount == null ? '—' : `${ad.spend_currency || ''} ${ad.spend_amount}`}
                    <div className="text-xs text-slate-400">{ad.spend_date || 'No spend date'}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex justify-end gap-3 whitespace-nowrap">
                      <button type="button" onClick={() => startEdit(ad)} className="text-xs text-teal-700">Edit</button>
                      <button type="button" onClick={() => toggleEnabled(ad)} className="text-xs text-slate-600">
                        {ad.is_enabled ? 'Disable' : 'Enable'}
                      </button>
                      {ad.is_manual && (
                        <button type="button" onClick={() => deleteManualAd(ad)} className="text-xs text-rose-600">Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && visibleAds.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No Meta ads match this view.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Loading Meta ads…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input className="input w-full" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function StatusField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <select className="input w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        {!STATUS_OPTIONS.includes(value) && <option value={value}>{value}</option>}
        {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
      </select>
    </label>
  )
}

function StatusBadge({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] ${
      active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'
    }`}>
      {children}
    </span>
  )
}

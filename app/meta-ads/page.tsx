'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'

type Tab = 'overview' | 'campaigns' | 'video' | 'intelligence' | 'audience' | 'location' | 'fatigue'
type RangeKey = 'month' | '7d' | '30d' | '90d' | 'ytd'

type Ad = {
  id: number; ad_id: string; ad_name: string | null; campaign_id: string | null; campaign_name: string | null
  adset_name: string | null; ad_effective_status: string | null; spend_amount: number | string | null
  spend_currency: string | null; spend_date: string | null; checked_at: string | null; last_synced_at: string | null
  is_current: boolean; is_enabled: boolean; creative_url: string | null
}
type Event = { ad_id: string | null; campaign_id: string | null; campaign_name: string | null; ad_name: string | null; received_at: string; labels: string[] | null }

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: '📊' },
  { key: 'campaigns', label: 'Campaigns', icon: '📋' },
  { key: 'video', label: 'Video', icon: '🎬' },
  { key: 'intelligence', label: 'Intelligence', icon: '🧠' },
  { key: 'audience', label: 'Audience', icon: '🎯' },
  { key: 'location', label: 'Location', icon: '🗺️' },
  { key: 'fatigue', label: 'Fatigue', icon: '⚡' },
]

function iso(d: Date) { return d.toISOString().slice(0, 10) }
function rangeStart(key: RangeKey) {
  const now = new Date()
  if (key === 'month') return iso(new Date(now.getFullYear(), now.getMonth(), 1))
  if (key === '7d') { const d = new Date(now); d.setDate(d.getDate() - 6); return iso(d) }
  if (key === '30d') { const d = new Date(now); d.setDate(d.getDate() - 29); return iso(d) }
  if (key === '90d') { const d = new Date(now); d.setDate(d.getDate() - 89); return iso(d) }
  return iso(new Date(now.getFullYear(), 0, 1))
}
function money(value: number, currency = 'USD') { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value) }
function short(value: string | null | undefined) { return value?.trim() || 'Unnamed' }

function Empty({ children }: { children: React.ReactNode }) { return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">{children}</div> }
function Card({ title, subtitle, children, className = '' }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}><div className="mb-4"><h2 className="text-sm font-semibold text-slate-800">{title}</h2>{subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}</div>{children}</section>
}
function Metric({ label, value, note, tone = 'text-slate-900' }: { label: string; value: string | number; note: string; tone?: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p><p className={`mt-2 text-2xl font-bold tabular-nums ${tone}`}>{value}</p><p className="mt-1 text-xs text-slate-400">{note}</p></div>
}
function Bars({ rows, valueLabel = 'conversations' }: { rows: { name: string; value: number; secondary?: string }[]; valueLabel?: string }) {
  if (!rows.length) return <Empty>No matching data is available for this period.</Empty>
  const max = Math.max(1, ...rows.map(r => r.value))
  return <div className="space-y-3">{rows.slice(0, 8).map((row, index) => <div key={`${row.name}-${index}`}><div className="mb-1 flex gap-3 text-xs"><span className="min-w-0 flex-1 truncate font-medium text-slate-700" title={row.name}>{row.name}</span><span className="shrink-0 text-slate-500">{row.value.toLocaleString()} {valueLabel}{row.secondary ? ` · ${row.secondary}` : ''}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(3, row.value / max * 100)}%` }} /></div></div>)}</div>
}

export default function MetaAdsPage() {
  const router = useRouter()
  const { profile, isAdmin, loading: authLoading } = useAuth()
  const [tab, setTab] = useState<Tab>('overview')
  const [range, setRange] = useState<RangeKey>('ytd')
  const [ads, setAds] = useState<Ad[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [renderedAt] = useState(() => Date.now())
  const start = useMemo(() => rangeStart(range), [range])

  useEffect(() => { if (!authLoading && profile && !isAdmin) router.replace('/') }, [authLoading, profile, isAdmin, router])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const [adsRes, eventsRes] = await Promise.all([
      supabase.from('meta_active_ads').select('id,ad_id,ad_name,campaign_id,campaign_name,adset_name,ad_effective_status,spend_amount,spend_currency,spend_date,checked_at,last_synced_at,is_current,is_enabled,creative_url').order('checked_at', { ascending: false }).limit(1000),
      supabase.from('messenger_events').select('ad_id,campaign_id,campaign_name,ad_name,received_at,labels').gte('received_at', `${start}T00:00:00`).order('received_at', { ascending: false }).limit(5000),
    ])
    const messages = [adsRes.error?.message, eventsRes.error?.message].filter(Boolean).join(' · ')
    if (messages) setError(messages)
    setAds((adsRes.data || []) as Ad[])
    setEvents((eventsRes.data || []) as Event[])
    setLoading(false)
  }, [start])
  useEffect(() => { if (isAdmin) void Promise.resolve().then(load) }, [isAdmin, load])

  const inRangeAds = useMemo(() => ads.filter(ad => !ad.spend_date || ad.spend_date >= start), [ads, start])
  const activeAds = useMemo(() => ads.filter(ad => ad.is_enabled && ad.ad_effective_status === 'ACTIVE'), [ads])
  const spend = useMemo(() => inRangeAds.reduce((sum, ad) => sum + Number(ad.spend_amount || 0), 0), [inRangeAds])
  const currency = useMemo(() => inRangeAds.find(ad => ad.spend_currency)?.spend_currency || 'USD', [inRangeAds])
  const latestSync = useMemo(() => ads.map(ad => ad.last_synced_at || ad.checked_at).filter(Boolean).sort().at(-1) || null, [ads])
  const eventsByAd = useMemo(() => {
    const map = new Map<string, number>(); events.forEach(e => { if (e.ad_id) map.set(e.ad_id, (map.get(e.ad_id) || 0) + 1) }); return map
  }, [events])
  const campaigns = useMemo(() => {
    const map = new Map<string, { name: string; ads: number; spend: number; conversations: number }>()
    inRangeAds.forEach(ad => { const key = ad.campaign_id || ad.campaign_name || 'unattributed'; const entry = map.get(key) || { name: short(ad.campaign_name), ads: 0, spend: 0, conversations: 0 }; entry.ads++; entry.spend += Number(ad.spend_amount || 0); map.set(key, entry) })
    events.forEach(e => { const key = e.campaign_id || e.campaign_name || 'unattributed'; const entry = map.get(key) || { name: short(e.campaign_name), ads: 0, spend: 0, conversations: 0 }; entry.conversations++; map.set(key, entry) })
    return [...map.values()].sort((a, b) => b.conversations - a.conversations || b.spend - a.spend)
  }, [inRangeAds, events])
  const adRows = useMemo(() => inRangeAds.map(ad => ({ ...ad, conversations: eventsByAd.get(ad.ad_id) || 0, cpr: (eventsByAd.get(ad.ad_id) || 0) > 0 ? Number(ad.spend_amount || 0) / (eventsByAd.get(ad.ad_id) || 0) : null })).sort((a, b) => b.conversations - a.conversations || Number(b.spend_amount || 0) - Number(a.spend_amount || 0)), [inRangeAds, eventsByAd])
  const labelRows = useMemo(() => {
    const map = new Map<string, number>(); events.forEach(e => (e.labels || []).forEach(label => map.set(label, (map.get(label) || 0) + 1))); return [...map].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [events])
  const videoAds = useMemo(() => adRows.filter(ad => /video|reel|ai generated|preview/i.test(`${ad.ad_name} ${ad.campaign_name}`)), [adRows])

  if (!isAdmin) return null
  const fresh = latestSync && renderedAt - new Date(latestSync).getTime() < 48 * 60 * 60 * 1000
  const cpr = events.length ? spend / events.length : null

  return <div className="space-y-5 pb-16">
    <header className="rounded-2xl bg-slate-950 px-5 py-5 text-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><h1 className="text-xl font-semibold">Ekagra Health · Facebook Ads Intelligence</h1><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${fresh ? 'bg-emerald-400/20 text-emerald-300' : 'bg-amber-400/20 text-amber-200'}`}>● {fresh ? 'LIVE' : 'SYNC NEEDED'}</span></div><p className="mt-1 text-sm text-slate-400">Meta spend, Messenger conversations, and CRM attribution in one workspace.</p></div><div className="flex flex-wrap items-center gap-2"><select aria-label="Date range" className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white" value={range} onChange={e => setRange(e.target.value as RangeKey)}><option value="ytd">Year to date</option><option value="month">This month</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option></select><button onClick={load} disabled={loading} className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-slate-900 disabled:opacity-50">↻ {loading ? 'Refreshing…' : 'Refresh'}</button></div></div>
      <nav className="mt-5 -mb-5 flex gap-1 overflow-x-auto" aria-label="Meta ads sections">{TABS.map(item => <button key={item.key} onClick={() => setTab(item.key)} className={`whitespace-nowrap rounded-t-lg px-3 py-2.5 text-sm transition ${tab === item.key ? 'bg-slate-50 font-semibold text-slate-900' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>{item.icon} {item.label}</button>)}</nav>
    </header>
    {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">Could not load all Meta dashboard data: {error}</div>}
    {!loading && <p className="text-xs text-slate-400">Period: {start}–{iso(new Date())} · Last Meta sync: {latestSync ? new Date(latestSync).toLocaleString() : 'not recorded'}</p>}
    {loading ? <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200" />)}</div> : <>
      {tab === 'overview' && <div className="space-y-4"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Spend" value={money(spend, currency)} note="Recorded spend in selected period" tone="text-indigo-700" /><Metric label="Conversations" value={events.length} note="Messenger events received" tone="text-indigo-700" /><Metric label="Cost / conversation" value={cpr == null ? '—' : money(cpr, currency)} note="Spend divided by matched events" tone="text-indigo-700" /><Metric label="Active ads" value={activeAds.length} note={`${campaigns.length} campaign groups in view`} tone="text-emerald-600" /></div><div className="grid gap-4 lg:grid-cols-2"><Card title="Monthly spend & conversations" subtitle="The current integration stores spend snapshots and Messenger events; use the table for the exact records."><Bars rows={campaigns.map(c => ({ name: c.name, value: c.conversations, secondary: c.spend ? money(c.spend, currency) : undefined }))} /></Card><Card title="Active ads — ranked by conversations" subtitle="Cost per conversation is calculated only when an ad has both a spend snapshot and matched Messenger events."><Bars rows={adRows.filter(row => row.ad_effective_status === 'ACTIVE').map(row => ({ name: short(row.ad_name), value: row.conversations, secondary: row.cpr == null ? undefined : money(row.cpr, currency) }))} /></Card></div></div>}
      {tab === 'campaigns' && <Card title="Campaign performance" subtitle="Campaign totals combine stored Meta spend with Messenger conversations received during the selected period."><CampaignTable rows={campaigns} currency={currency} /></Card>}
      {tab === 'video' && <div className="grid gap-4 lg:grid-cols-2"><Card title="Video creative performance" subtitle="Video is inferred from campaign/ad naming until creative-format reporting is synced."><Bars rows={videoAds.map(ad => ({ name: short(ad.ad_name), value: ad.conversations, secondary: ad.cpr == null ? undefined : money(ad.cpr, currency) }))} /></Card><Card title="Creative coverage" subtitle="A preview link is shown only when Meta supplied one.">{videoAds.length ? <div className="space-y-3">{videoAds.slice(0, 10).map(ad => <div key={ad.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 text-sm"><span className="min-w-0 truncate text-slate-700">{short(ad.ad_name)}</span>{ad.creative_url ? <a className="shrink-0 text-xs font-medium text-indigo-700" href={ad.creative_url} target="_blank" rel="noreferrer">Open creative ↗</a> : <span className="shrink-0 text-xs text-slate-400">No preview URL</span>}</div>)}</div> : <Empty>No ads match the current video naming rules.</Empty>}</Card></div>}
      {tab === 'intelligence' && <div className="grid gap-4 lg:grid-cols-3"><Insight tone={fresh ? 'good' : 'warn'} title={fresh ? 'Data connection is current' : 'Meta sync is stale'} text={fresh ? `The latest sync completed ${new Date(latestSync!).toLocaleString()}.` : 'Run the secured Meta sync job so active-status and spend snapshots are current.'} /><Insight tone={events.length ? 'good' : 'warn'} title={events.length ? `${events.length} Messenger events captured` : 'No Messenger events in this period'} text={events.length ? 'Conversation volume is attributed to ads/campaigns when Meta referral metadata is present.' : 'Check the Meta webhook and date filter before judging campaign performance.'} /><Insight tone={activeAds.length ? 'good' : 'warn'} title={`${activeAds.length} active ads recorded`} text={activeAds.length ? 'Review high-spend ads with no conversations first; they are listed in Fatigue.' : 'The latest available ad snapshot contains no enabled active ads.'} /></div>}
      {tab === 'audience' && <div className="grid gap-4 lg:grid-cols-2"><Card title="Messenger labels" subtitle="Labels captured from incoming Messenger events; each event can have more than one label."><Bars rows={labelRows} valueLabel="events" /></Card><Card title="Attribution coverage" subtitle="How much of the selected Messenger traffic has ad-level metadata."><div className="space-y-3"><Coverage label="Ad ID present" value={events.filter(e => !!e.ad_id).length} total={events.length} /><Coverage label="Campaign ID present" value={events.filter(e => !!e.campaign_id).length} total={events.length} /><Coverage label="Labels present" value={events.filter(e => (e.labels || []).length > 0).length} total={events.length} /></div></Card></div>}
      {tab === 'location' && <Card title="Location intelligence" subtitle="Location targeting is not yet persisted by the Meta sync, so this tab intentionally does not invent a geographic breakdown."><Empty>Connect Meta Insights with a geographic breakdown (for example, region or city) to populate this tab. The current sync records ad status, spend, creative metadata, and Messenger attribution only.</Empty></Card>}
      {tab === 'fatigue' && <Card title="Creative fatigue monitor" subtitle="A pragmatic monitoring queue based on the data currently stored; it is not a Meta frequency/reach calculation."><FatigueTable rows={adRows.filter(ad => ad.ad_effective_status === 'ACTIVE' || Number(ad.spend_amount || 0) > 0)} stale={!fresh} currency={currency} /></Card>}
    </>}
  </div>
}

function CampaignTable({ rows, currency }: { rows: { name: string; ads: number; spend: number; conversations: number }[]; currency: string }) {
  if (!rows.length) return <Empty>No campaign or Messenger attribution records match the selected period.</Empty>
  return <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400"><tr><th className="pb-2 font-medium">Campaign</th><th className="pb-2 text-right font-medium">Ads</th><th className="pb-2 text-right font-medium">Spend</th><th className="pb-2 text-right font-medium">Conversations</th><th className="pb-2 text-right font-medium">Cost / conversation</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map(row => <tr key={row.name}><td className="max-w-[350px] truncate py-3 font-medium text-slate-700" title={row.name}>{row.name}</td><td className="py-3 text-right text-slate-500">{row.ads}</td><td className="py-3 text-right text-slate-700">{money(row.spend, currency)}</td><td className="py-3 text-right text-slate-700">{row.conversations}</td><td className="py-3 text-right font-medium text-indigo-700">{row.conversations ? money(row.spend / row.conversations, currency) : '—'}</td></tr>)}</tbody></table></div>
}
function Insight({ title, text, tone }: { title: string; text: string; tone: 'good' | 'warn' }) { return <div className={`rounded-xl border p-4 ${tone === 'good' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}><p className={`text-sm font-semibold ${tone === 'good' ? 'text-emerald-800' : 'text-amber-800'}`}>{title}</p><p className={`mt-2 text-sm ${tone === 'good' ? 'text-emerald-700' : 'text-amber-700'}`}>{text}</p></div> }
function Coverage({ label, value, total }: { label: string; value: number; total: number }) { const percent = total ? Math.round(value / total * 100) : 0; return <div><div className="mb-1 flex justify-between text-sm"><span className="text-slate-600">{label}</span><span className="font-semibold text-slate-800">{value}/{total} · {percent}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${percent}%` }} /></div></div> }
function FatigueTable({ rows, stale, currency }: { rows: (Ad & { conversations: number; cpr: number | null })[]; stale: boolean; currency: string }) { if (!rows.length) return <Empty>No active or spending ads are available to monitor.</Empty>; return <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400"><tr><th className="pb-2 font-medium">Ad</th><th className="pb-2 text-right font-medium">Spend</th><th className="pb-2 text-right font-medium">Conversations</th><th className="pb-2 text-right font-medium">Signal</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.slice(0, 50).map(ad => { const weak = Number(ad.spend_amount || 0) > 0 && ad.conversations === 0; const label = stale ? 'Verify sync' : weak ? 'Review: spend, no conversations' : ad.cpr != null ? `Tracking · ${money(ad.cpr, currency)} CPR` : 'No spend/conversation match'; return <tr key={ad.id}><td className="max-w-[400px] truncate py-3 font-medium text-slate-700" title={short(ad.ad_name)}>{short(ad.ad_name)}</td><td className="py-3 text-right text-slate-700">{money(Number(ad.spend_amount || 0), currency)}</td><td className="py-3 text-right text-slate-700">{ad.conversations}</td><td className={`py-3 text-right text-xs font-medium ${weak || stale ? 'text-amber-700' : 'text-emerald-700'}`}>{label}</td></tr> })}</tbody></table></div> }

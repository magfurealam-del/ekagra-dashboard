# Ekagra Health — Call Center Dashboard

A Next.js dashboard connected to Supabase for Ekagra Health's call center operations.

## 🚀 Deployment (One-Time Setup)

### Prerequisites
- Node.js 18+ installed on your machine
- Vercel account (already set up: team `ekagra-dhanmondi`)

### Step 1 — Get your Supabase Service Role Key
1. Go to: https://supabase.com/dashboard/project/youqgrwovfyqqsnbtcnm/settings/api
2. Copy the **service_role** key (the long secret one, NOT the anon key)
3. Open `.env.local` and replace `YOUR_SERVICE_ROLE_KEY_HERE` with it

### Step 2 — Deploy
```bash
# Login to Vercel (only needed once)
npx vercel login

# Deploy (installs, builds, and pushes to Vercel automatically)
./deploy.sh
```

That's it! The URL will be printed at the end.

---

## 📋 Pages

| Page | URL | Purpose |
|------|-----|---------|
| Dashboard | `/dashboard` | KPIs, charts, daily summary |
| Call Center | `/call-center` | Main log table (replaces Google Sheet) |
| New Lead | `/call-center/new` | Agent form for new entries |
| Lead Detail | `/call-center/[id]` | Edit individual records |
| Appointments | `/appointments` | Daily appointment view |
| Outbound Calls | `/outbound-calls` | Priority call queue for agents |
| No Shows | `/no-shows` | No-show list with callback button |
| Callbacks | `/callbacks` | Callback task management |
| Settings | `/settings/dropdowns` | Admin: manage all dropdown values |

---

## 🗄️ Supabase Details

- **Project URL**: https://youqgrwovfyqqsnbtcnm.supabase.co
- **Region**: ap-northeast-1 (Tokyo)
- **Main table**: `call_center_logs` (1,071 rows)

### Tables created by this project:
- `callback_tasks` — outbound/follow-up task queue
- `call_interactions` — every call attempt logged
- `lookup_*` (13 tables) — dropdown values

---

## 🔑 Environment Variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (safe to expose) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (safe to expose) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** — server-only, never expose publicly |

---

## 📞 Agent Quick Guide

1. **New lead comes in** → Click "+ New Lead" → Fill form → Save
2. **Update a record** → Find in Call Center table → Click "Edit" (inline) or "View" (full form)
3. **No show?** → Final status "No Show" auto-creates a callback task
4. **Outbound calls** → Go to "Outbound" → Work down the priority list → Log each call outcome
5. **Follow-ups** → Max 3 attempts per patient → Auto-closes after 3rd attempt

---

## 🔒 Security

- All sensitive writes go through `/api/*` server-side routes using the service role key
- The service role key is **never** exposed to the browser
- Supabase RLS is enabled on all tables
- All authenticated users can read/write call center data (no anonymous access)

<!-- Deployed: 2026-06-25T11:54:26Z -->

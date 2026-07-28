create table if not exists public.messenger_events (
  id              uuid primary key default gen_random_uuid(),
  psid            text not null,
  page_id         text not null,
  message_text    text,
  ad_id           text,
  campaign_id     text,
  adset_id        text,
  referral_source text,
  referral_type   text,
  raw_payload     jsonb not null,
  received_at     timestamptz not null default now(),
  processed       boolean not null default false,
  crm_lead_id     uuid references public.crm_leads(id) on delete set null
);

create index if not exists messenger_events_psid_idx        on public.messenger_events(psid);
create index if not exists messenger_events_campaign_id_idx on public.messenger_events(campaign_id);
create index if not exists messenger_events_processed_idx   on public.messenger_events(processed) where processed = false;
create index if not exists messenger_events_received_at_idx on public.messenger_events(received_at desc);

alter table public.messenger_events enable row level security;

create policy "service role can insert messenger events"
  on public.messenger_events for insert to service_role with check (true);

create policy "admins can read messenger events"
  on public.messenger_events for select to authenticated
  using (exists (
    select 1 from public.user_profiles
    where id = (select auth.uid()) and role = 'admin' and is_active = true
  ));

create policy "service role can update messenger events"
  on public.messenger_events for update to service_role using (true);

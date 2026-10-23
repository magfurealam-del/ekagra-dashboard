alter table public.messenger_events
  add column if not exists labels text[] default '{}';

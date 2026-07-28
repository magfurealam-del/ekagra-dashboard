alter table public.messenger_events
  add column if not exists meta_message_id text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'messenger_events_meta_message_id_key'
      and conrelid = 'public.messenger_events'::regclass
  ) then
    alter table public.messenger_events
      add constraint messenger_events_meta_message_id_key unique (meta_message_id);
  end if;
end $$;

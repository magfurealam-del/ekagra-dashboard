-- Fix 1: crm_lead_id on messenger_events must be bigint (crm_leads.id is bigint)
alter table public.messenger_events
  alter column crm_lead_id type bigint using null;

-- Fix 2: unique constraint on lead_attribution.lead_id so ON CONFLICT works
alter table public.lead_attribution
  add constraint lead_attribution_lead_id_key unique (lead_id);

-- Fix 3: add messenger tracking columns if not already present
alter table public.lead_attribution
  add column if not exists messenger_psid  text,
  add column if not exists attributed_at   timestamptz;

-- Fix 4: corrected reconciliation function
--   - matches on crm_leads.phone_normalized (not phone_e164)
--   - lead_id cast to bigint throughout
--   - ON CONFLICT now works via the unique constraint above
create or replace function public.reconcile_messenger_leads()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_processed   int := 0;
  v_matched     int := 0;
  v_ambiguous   int := 0;
  v_event       record;
  v_phones      text[];
  v_phone       text;
  v_norm        text;
  v_lead_ids    bigint[];
  v_lead_id     bigint;
begin
  for v_event in
    select id, psid, message_text, ad_id, campaign_id, adset_id, received_at
    from   public.messenger_events
    where  processed = false
    and    message_text is not null
    order  by received_at asc
    limit  500
  loop
    v_processed := v_processed + 1;
    v_lead_id   := null;
    v_phones    := array[]::text[];

    -- Extract BD mobile numbers: handles 01XXXXXXXXX, +8801XXXXXXXXX, 8801XXXXXXXXX
    select array_agg(m[1]) into v_phones
    from   regexp_matches(
             v_event.message_text,
             '(?:(?:\+|00)?880)?0?1[3-9]\d{8}',
             'g'
           ) m;

    if v_phones is null or array_length(v_phones, 1) = 0 then
      update public.messenger_events set processed = true where id = v_event.id;
      continue;
    end if;

    foreach v_phone in array v_phones loop
      v_norm := public.normalize_bd_phone(v_phone);

      -- Match against phone_normalized; lead created within 7 days after the event
      select array_agg(cl.id) into v_lead_ids
      from   public.crm_leads cl
      where  cl.phone_normalized = v_norm
      and    cl.created_at >= v_event.received_at - interval '1 day'
      and    cl.created_at <= v_event.received_at + interval '7 days';

      if v_lead_ids is not null and array_length(v_lead_ids, 1) = 1 then
        v_lead_id := v_lead_ids[1];
        exit;
      elsif v_lead_ids is not null and array_length(v_lead_ids, 1) > 1 then
        v_ambiguous := v_ambiguous + 1;
      end if;
    end loop;

    if v_lead_id is not null and v_event.campaign_id is not null then
      insert into public.lead_attribution (
        lead_id,
        source_category,
        attribution_level,
        meta_ad_id,
        meta_campaign_id,
        meta_adset_id,
        messenger_psid,
        attributed_at
      ) values (
        v_lead_id,
        'Facebook Ad',
        'ad',
        v_event.ad_id,
        v_event.campaign_id,
        v_event.adset_id,
        v_event.psid,
        now()
      )
      on conflict (lead_id) do update set
        source_category  = excluded.source_category,
        attribution_level = excluded.attribution_level,
        meta_ad_id       = excluded.meta_ad_id,
        meta_campaign_id = excluded.meta_campaign_id,
        meta_adset_id    = excluded.meta_adset_id,
        messenger_psid   = excluded.messenger_psid,
        attributed_at    = excluded.attributed_at;

      update public.messenger_events
      set    processed   = true,
             crm_lead_id = v_lead_id
      where  id = v_event.id;

      v_matched := v_matched + 1;
    else
      update public.messenger_events set processed = true where id = v_event.id;
    end if;

  end loop;

  return jsonb_build_object(
    'processed',  v_processed,
    'matched',    v_matched,
    'ambiguous',  v_ambiguous,
    'unmatched',  v_processed - v_matched - v_ambiguous
  );
end;
$$;

revoke all on function public.reconcile_messenger_leads() from public;
grant execute on function public.reconcile_messenger_leads() to service_role;

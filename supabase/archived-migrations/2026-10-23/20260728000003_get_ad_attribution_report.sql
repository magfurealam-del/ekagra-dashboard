-- Returns per-ad attribution metrics for the admin dashboard tab.
-- Joins lead_attribution → crm_leads → crm_appointments → crm_invoice_reconciliation.
create or replace function public.get_ad_attribution_report(p_start_date date, p_end_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_rows jsonb;
begin
  if not exists (
    select 1 from public.user_profiles
    where id = (select auth.uid()) and role = 'admin' and is_active = true
  ) then
    raise exception 'Admin access required.';
  end if;

  select coalesce(jsonb_agg(row order by row.leads desc), '[]'::jsonb) into v_rows
  from (
    select
      la.meta_campaign_id                                           as campaign_id,
      la.meta_ad_id                                                 as ad_id,
      la.meta_ad_name                                               as ad_name,
      la.meta_campaign_name                                         as campaign_name,
      count(distinct cl.id)                                         as leads,
      count(distinct cl.id) filter (
        where cl.lead_status = 'appointment_booked'
           or exists (
             select 1 from public.crm_appointments ca2
             where ca2.lead_id = cl.id
           )
      )                                                             as booked,
      count(distinct ca.id)                                         as appointments,
      count(distinct ca.id) filter (
        where ca.appointment_status = 'Completed'
      )                                                             as completed,
      coalesce(sum(i.net_bill) filter (
        where cir.match_status in ('matched', 'approved_auto')
      ), 0)                                                         as revenue
    from      public.lead_attribution    la
    join      public.crm_leads           cl  on cl.id  = la.lead_id
    left join public.crm_appointments    ca  on ca.lead_id = cl.id
    left join public.crm_invoice_reconciliation cir on cir.crm_lead_id = cl.id
    left join public.invoices             i   on i.invoice_no = cir.invoice_no
    where la.meta_campaign_id is not null
      and cl.created_at::date between p_start_date and p_end_date
    group by la.meta_campaign_id, la.meta_ad_id, la.meta_ad_name, la.meta_campaign_name
  ) row;

  return v_rows;
end;
$$;

revoke all on function public.get_ad_attribution_report(date, date) from public;
grant execute on function public.get_ad_attribution_report(date, date) to authenticated;

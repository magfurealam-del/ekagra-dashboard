-- Materialized dashboard metrics read by the browser. Refresh from the 6:00 AM
-- Bangladesh cron or an authenticated admin action; do not run the expensive
-- metrics RPC during page rendering.
create table if not exists public.dashboard_metric_snapshots (
  snapshot_key text primary key,
  start_date date not null,
  end_date date not null,
  metrics jsonb not null,
  refreshed_at timestamptz not null default now(),
  refreshed_by uuid null
);

alter table public.dashboard_metric_snapshots enable row level security;

create policy "admins can read dashboard metric snapshots"
on public.dashboard_metric_snapshots for select to authenticated
using (exists (select 1 from public.user_profiles where id = (select auth.uid()) and role = 'admin' and is_active = true));

create or replace function public.refresh_dashboard_metric_snapshot(p_start_date date, p_end_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_metrics jsonb; v_key text := p_start_date::text || ':' || p_end_date::text;
begin
  if not exists (select 1 from public.user_profiles where id = (select auth.uid()) and role = 'admin' and is_active = true) then raise exception 'admin access required'; end if;
  select to_jsonb(m) into v_metrics from public.get_admin_dashboard_metrics(p_start_date, p_end_date) m;
  insert into public.dashboard_metric_snapshots(snapshot_key,start_date,end_date,metrics,refreshed_by)
  values (v_key,p_start_date,p_end_date,v_metrics,(select auth.uid()))
  on conflict (snapshot_key) do update set metrics=excluded.metrics,refreshed_at=now(),refreshed_by=excluded.refreshed_by;
  return jsonb_build_object('snapshot_key',v_key,'metrics',v_metrics,'refreshed_at',now());
end; $$;
revoke all on function public.refresh_dashboard_metric_snapshot(date,date) from public;
grant execute on function public.refresh_dashboard_metric_snapshot(date,date) to authenticated;

create or replace function public.refresh_dashboard_metric_snapshot_cron(p_start_date date, p_end_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_metrics jsonb; v_key text := p_start_date::text || ':' || p_end_date::text;
begin
  select to_jsonb(m) into v_metrics from public.get_admin_dashboard_metrics(p_start_date, p_end_date) m;
  insert into public.dashboard_metric_snapshots(snapshot_key,start_date,end_date,metrics)
  values (v_key,p_start_date,p_end_date,v_metrics)
  on conflict (snapshot_key) do update set metrics=excluded.metrics,refreshed_at=now(),refreshed_by=null;
  return jsonb_build_object('snapshot_key',v_key,'metrics',v_metrics,'refreshed_at',now());
end; $$;
revoke all on function public.refresh_dashboard_metric_snapshot_cron(date,date) from public;

-- Use canonical attribution and validated invoice reconciliation for snapshots.
create or replace function public.get_admin_dashboard_metrics_validated(p_start_date date, p_end_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_base jsonb; v_sources jsonb; v_revenue jsonb;
begin
  if not is_admin() then raise exception 'Admin access required.'; end if;
  v_base := public.get_admin_dashboard_metrics(p_start_date, p_end_date);
  select coalesce(jsonb_agg(jsonb_build_object('source', source_name, 'count', lead_count) order by lead_count desc), '[]'::jsonb) into v_sources
  from (select coalesce(nullif(la.source_category,''), nullif(cl.source,''), 'Unknown') source_name, count(*) lead_count
        from crm_leads cl left join lead_attribution la on la.lead_id = cl.id
        where cl.created_at::date between p_start_date and p_end_date group by 1) s;
  select coalesce(jsonb_agg(jsonb_build_object('source', source_name, 'revenue', revenue) order by revenue desc), '[]'::jsonb) into v_revenue
  from (select coalesce(nullif(la.source_category,''), nullif(cl.source,''), 'Unknown') source_name, sum(i.net_bill) revenue
        from crm_invoice_reconciliation cir join invoices i on i.invoice_no = cir.invoice_no
        left join crm_leads cl on cl.id = cir.crm_lead_id left join lead_attribution la on la.lead_id = cl.id
        where cir.match_status in ('matched','approved_auto') and cir.invoice_date between p_start_date and p_end_date
          and i.reconciliation_status is distinct from 'needs_review' group by 1) r;
  return v_base || jsonb_build_object('by_source', v_sources, 'revenue_by_source', v_revenue,
    'validation', jsonb_build_object('source_tables', jsonb_build_array('crm_leads','lead_attribution','patient_marketing_attribution'),
      'invoice_tables', jsonb_build_array('crm_invoice_reconciliation','invoices','invoice_line_items'),
      'approved_invoice_matches', (select count(*) from crm_invoice_reconciliation where match_status in ('matched','approved_auto') and invoice_date between p_start_date and p_end_date),
      'invoice_matches_needing_review', (select count(*) from crm_invoice_reconciliation where match_status like 'needs_review%' and invoice_date between p_start_date and p_end_date)));
end; $$;
revoke all on function public.get_admin_dashboard_metrics_validated(date,date) from public;
grant execute on function public.get_admin_dashboard_metrics_validated(date,date) to authenticated, service_role;

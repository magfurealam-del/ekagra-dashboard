-- Durable, resumable Meta daily insights. Existing legacy spend is preserved;
-- initial backfill starts after its last covered date. Native currencies are
-- kept separate; the gateway never invents exchange rates.
CREATE TABLE mis_internal.marketing_spend_sync_state(
 account_id text PRIMARY KEY,currency text,last_completed_date date,last_refresh_date date,
 window_start date,window_end date,after_cursor text,lease_token uuid,lease_until timestamptz,
 status text NOT NULL DEFAULT 'pending',last_error_code text,last_success_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mis_internal.marketing_spend_observations(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,account_id text NOT NULL,window_start date NOT NULL,window_end date NOT NULL,
 page_cursor text NOT NULL DEFAULT '',currency text NOT NULL,response_sha256 text NOT NULL,rows jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),UNIQUE(account_id,window_start,window_end,page_cursor,response_sha256)
);
ALTER TABLE mis_internal.marketing_spend_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.marketing_spend_sync_state FORCE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.marketing_spend_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.marketing_spend_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON mis_internal.marketing_spend_sync_state,mis_internal.marketing_spend_observations FROM PUBLIC,anon,authenticated;
CREATE FUNCTION mis_internal.reject_marketing_observation_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Marketing source observations are immutable' USING ERRCODE='55000'; END $$;
REVOKE ALL ON FUNCTION mis_internal.reject_marketing_observation_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_marketing_spend_observations BEFORE UPDATE OR DELETE ON mis_internal.marketing_spend_observations
 FOR EACH ROW EXECUTE FUNCTION mis_internal.reject_marketing_observation_mutation();
CREATE TRIGGER mis_marketing_spend_dirty AFTER INSERT OR UPDATE OR DELETE ON public.marketing_daily_spend
 FOR EACH STATEMENT EXECUTE FUNCTION mis_internal.mark_marketing_evidence_dirty();

CREATE FUNCTION public.claim_marketing_spend_sync(p_account_id text,p_today date) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $claim$
DECLARE s mis_internal.marketing_spend_sync_state%rowtype; token uuid; v_start date; v_end date;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 IF p_account_id !~ '^[0-9]{5,30}$' OR p_today NOT BETWEEN current_date-2 AND current_date+2 THEN
  RAISE EXCEPTION 'invalid account or account-local date' USING ERRCODE='22023'; END IF;
 INSERT INTO mis_internal.marketing_spend_sync_state(account_id,last_completed_date)
  SELECT p_account_id,coalesce(max(date),p_today-8) FROM public.marketing_daily_spend ON CONFLICT(account_id) DO NOTHING;
 SELECT * INTO STRICT s FROM mis_internal.marketing_spend_sync_state WHERE account_id=p_account_id FOR UPDATE;
 IF s.lease_until>now() THEN RETURN jsonb_build_object('status','busy'); END IF;
 IF s.window_start IS NOT NULL THEN v_start:=s.window_start;v_end:=s.window_end;
 ELSIF s.last_completed_date<p_today-1 THEN v_start:=s.last_completed_date+1;v_end:=least(v_start+6,p_today-1);
 ELSIF s.last_refresh_date=p_today THEN RETURN jsonb_build_object('status','idle');
 ELSE v_start:=p_today-7;v_end:=p_today-1; END IF;
 token:=gen_random_uuid();
 UPDATE mis_internal.marketing_spend_sync_state SET lease_token=token,lease_until=now()+interval '90 seconds',
  window_start=v_start,window_end=v_end,status='running',updated_at=now() WHERE account_id=p_account_id;
 RETURN jsonb_build_object('status','claimed','token',token,'since',v_start,'until',v_end,'after',s.after_cursor);
END $claim$;

CREATE FUNCTION public.apply_marketing_spend_page(p_account_id text,p_token uuid,p_today date,p_currency text,p_rows jsonb,p_next_cursor text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $apply$
DECLARE s mis_internal.marketing_spend_sync_state%rowtype; observation bigint; r jsonb; v_n integer:=0; conversations numeric;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT s FROM mis_internal.marketing_spend_sync_state WHERE account_id=p_account_id FOR UPDATE;
 IF s.lease_token IS DISTINCT FROM p_token OR s.lease_until<now() THEN RAISE EXCEPTION 'expired sync lease' USING ERRCODE='55000'; END IF;
 IF p_currency NOT IN('USD','BDT') OR (s.currency IS NOT NULL AND s.currency<>p_currency) THEN
  RAISE EXCEPTION 'unsupported or changed account currency' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)>500 THEN RAISE EXCEPTION 'invalid insights page'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x GROUP BY x->>'date_start',x->>'ad_id' HAVING count(*)>1) THEN
  RAISE EXCEPTION 'duplicate ad/day within insights page'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x WHERE
  coalesce(x->>'ad_id','') !~ '^[0-9]+$' OR coalesce(x->>'campaign_id','') !~ '^[0-9]+$'
  OR coalesce(x->>'adset_id','') !~ '^[0-9]+$' OR coalesce(x->>'spend','') !~ '^[0-9]+([.][0-9]+)?$'
  OR (x->>'date_start')::date NOT BETWEEN s.window_start AND s.window_end
  OR x->>'date_start' IS DISTINCT FROM x->>'date_stop') THEN RAISE EXCEPTION 'insights row validation failed'; END IF;
 INSERT INTO mis_internal.marketing_spend_observations(account_id,window_start,window_end,page_cursor,currency,response_sha256,rows)
 VALUES(p_account_id,s.window_start,s.window_end,coalesce(s.after_cursor,''),p_currency,encode(extensions.digest(p_rows::text,'sha256'),'hex'),p_rows)
 ON CONFLICT(account_id,window_start,window_end,page_cursor,response_sha256) DO NOTHING RETURNING id INTO observation;
 IF observation IS NULL THEN SELECT id INTO observation FROM mis_internal.marketing_spend_observations
  WHERE account_id=p_account_id AND window_start=s.window_start AND window_end=s.window_end
   AND page_cursor=coalesce(s.after_cursor,'') AND response_sha256=encode(extensions.digest(p_rows::text,'sha256'),'hex'); END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  SELECT coalesce(sum((x->>'value')::numeric) FILTER(WHERE x->>'action_type'='onsite_conversion.messaging_conversation_started_7d'),
   sum((x->>'value')::numeric) FILTER(WHERE x->>'action_type'='onsite_conversion.total_messaging_connection'),0)
   INTO conversations FROM jsonb_array_elements(coalesce(r->'actions','[]')) x;
  INSERT INTO public.marketing_daily_spend(date,meta_campaign_id,meta_campaign_name,meta_adset_id,meta_adset_name,meta_ad_id,meta_ad_name,
   spend_usd,spend_bdt,impressions,reach,clicks,link_clicks,conversations,frequency,ctr,cpc,cpm,source_payload,updated_at)
  VALUES((r->>'date_start')::date,r->>'campaign_id',r->>'campaign_name',r->>'adset_id',r->>'adset_name',r->>'ad_id',r->>'ad_name',
   CASE WHEN p_currency='USD' THEN (r->>'spend')::numeric END,CASE WHEN p_currency='BDT' THEN (r->>'spend')::numeric END,
   coalesce((r->>'impressions')::integer,0),coalesce((r->>'reach')::integer,0),coalesce((r->>'clicks')::integer,0),
   coalesce((r->>'inline_link_clicks')::integer,0),conversations::integer,(r->>'frequency')::numeric,(r->>'ctr')::numeric,(r->>'cpc')::numeric,(r->>'cpm')::numeric,
   jsonb_build_object('integration','meta_ads_insights','account_id',p_account_id,'currency',p_currency,'observation_id',observation,'data',r),now())
  ON CONFLICT(date,meta_campaign_id,meta_adset_id,meta_ad_id) DO UPDATE SET
   meta_campaign_name=excluded.meta_campaign_name,meta_adset_name=excluded.meta_adset_name,meta_ad_name=excluded.meta_ad_name,
   spend_usd=excluded.spend_usd,spend_bdt=excluded.spend_bdt,impressions=excluded.impressions,reach=excluded.reach,clicks=excluded.clicks,
   link_clicks=excluded.link_clicks,conversations=excluded.conversations,frequency=excluded.frequency,ctr=excluded.ctr,cpc=excluded.cpc,cpm=excluded.cpm,
   source_payload=excluded.source_payload,updated_at=excluded.updated_at;
  v_n:=v_n+1;
 END LOOP;
 UPDATE mis_internal.marketing_spend_sync_state SET currency=p_currency,lease_token=NULL,lease_until=NULL,last_error_code=NULL,
  after_cursor=nullif(p_next_cursor,''),window_start=CASE WHEN nullif(p_next_cursor,'') IS NOT NULL THEN s.window_start END,
  window_end=CASE WHEN nullif(p_next_cursor,'') IS NOT NULL THEN s.window_end END,
  last_completed_date=CASE WHEN nullif(p_next_cursor,'') IS NULL THEN greatest(s.last_completed_date,s.window_end) ELSE s.last_completed_date END,
  last_refresh_date=CASE WHEN nullif(p_next_cursor,'') IS NULL AND s.window_end>=p_today-1 THEN p_today ELSE s.last_refresh_date END,
  status=CASE WHEN nullif(p_next_cursor,'') IS NOT NULL OR s.window_end<p_today-1 THEN 'backfill' ELSE 'succeeded' END,
  last_success_at=now(),updated_at=now() WHERE account_id=p_account_id;
 RETURN jsonb_build_object('status','applied','rows',v_n,'through',s.window_end,'page_complete',nullif(p_next_cursor,'') IS NULL);
END $apply$;

CREATE FUNCTION public.fail_marketing_spend_sync(p_account_id text,p_token uuid,p_code text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fail$
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
 UPDATE mis_internal.marketing_spend_sync_state SET status='failed',last_error_code=left(p_code,120),lease_token=NULL,lease_until=NULL,updated_at=now()
 WHERE account_id=p_account_id AND lease_token=p_token;
END $fail$;
REVOKE ALL ON FUNCTION public.claim_marketing_spend_sync(text,date),public.apply_marketing_spend_page(text,uuid,date,text,jsonb,text),public.fail_marketing_spend_sync(text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_marketing_spend_sync(text,date),public.apply_marketing_spend_page(text,uuid,date,text,jsonb,text),public.fail_marketing_spend_sync(text,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION mis_internal.marketing_source_health() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $health$
 SELECT jsonb_build_object('latestStoredSpendDate',(SELECT max(date) FROM public.marketing_daily_spend),
 'spendAccounts',coalesce((SELECT jsonb_agg(jsonb_build_object('status',status,'currency',currency,'through',last_completed_date,'lastSuccess',last_success_at,'errorCode',last_error_code))
  FROM mis_internal.marketing_spend_sync_state),'[]'),
 'metaIdentityReviewsOpen',(SELECT count(*) FROM public.meta_call_center_reconciliation WHERE review_status IN('unreviewed','needs_review')));
$health$;
REVOKE ALL ON FUNCTION mis_internal.marketing_source_health() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.request_marketing_reconciliation(p_actor_id uuid,p_upload_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_revision bigint;
BEGIN
 PERFORM mis_internal.assert_mis_upload_admin(p_actor_id);
 IF NOT EXISTS(SELECT 1 FROM mis_internal.mis_gateway_batches b JOIN mis_internal.mis_upload_parses p ON p.id=b.parse_id WHERE p.upload_id=p_upload_id) THEN
  RAISE EXCEPTION 'Accepted upload not found' USING ERRCODE='22023'; END IF;
 UPDATE mis_internal.marketing_reconciliation_state SET revision=revision+1 WHERE singleton RETURNING revision INTO v_revision;
 RETURN jsonb_build_object('status','queued','sourceRevision',v_revision);
END $$;
REVOKE ALL ON FUNCTION public.request_marketing_reconciliation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_marketing_reconciliation(uuid,uuid) TO service_role;


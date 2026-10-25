-- One canonical Meta insights cache, plus a compatibility projection for older
-- consumers. Preserve every preexisting legacy row before rebuilding overlap.
CREATE TABLE mis_internal.marketing_spend_legacy_baseline(
 legacy_id bigint PRIMARY KEY,row_data jsonb NOT NULL,captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mis_internal.marketing_spend_legacy_baseline ENABLE ROW LEVEL SECURITY;
ALTER TABLE mis_internal.marketing_spend_legacy_baseline FORCE ROW LEVEL SECURITY;
REVOKE ALL ON mis_internal.marketing_spend_legacy_baseline FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO mis_internal.marketing_spend_legacy_baseline(legacy_id,row_data)
 SELECT id,to_jsonb(s) FROM public.meta_ad_spend_daily s;
CREATE TRIGGER immutable_marketing_spend_legacy_baseline BEFORE UPDATE OR DELETE
 ON mis_internal.marketing_spend_legacy_baseline FOR EACH ROW
 EXECUTE FUNCTION mis_internal.reject_marketing_observation_mutation();

CREATE FUNCTION mis_internal.project_verified_marketing_spend(p_date date DEFAULT NULL,p_ad_id text DEFAULT NULL)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 INSERT INTO public.meta_ad_spend_daily(spend_date,ad_account_id,currency,ad_id,ad_name,campaign_id,adset_id,amount_spent,synced_at,raw_payload)
 SELECT m.date,o.account_id,o.currency,m.meta_ad_id,m.meta_ad_name,m.meta_campaign_id,m.meta_adset_id,
  CASE WHEN o.currency='USD' THEN m.spend_usd ELSE m.spend_bdt END,now(),
  (m.source_payload->'data')||jsonb_build_object('_gateway_observation_id',o.id)
 FROM public.marketing_daily_spend m JOIN mis_internal.marketing_spend_observations o
  ON o.id=CASE WHEN m.source_payload->>'observation_id' ~ '^[0-9]+$' THEN (m.source_payload->>'observation_id')::bigint END
 WHERE (p_date IS NULL OR m.date=p_date) AND (p_ad_id IS NULL OR m.meta_ad_id=p_ad_id)
  AND m.source_payload->>'integration'='meta_ads_insights' AND m.source_payload->>'account_id'=o.account_id
  AND m.source_payload->>'currency'=o.currency AND o.currency IN('USD','BDT')
  AND m.date BETWEEN o.window_start AND o.window_end AND o.rows @> jsonb_build_array(m.source_payload->'data')
  AND m.source_payload->'data'->>'ad_id'=m.meta_ad_id
  AND m.source_payload->'data'->>'adset_id'=m.meta_adset_id
  AND m.source_payload->'data'->>'campaign_id'=m.meta_campaign_id
  AND m.source_payload->'data'->>'date_start'=m.date::text
  AND (m.source_payload->'data'->>'spend')::numeric=CASE WHEN o.currency='USD' THEN m.spend_usd ELSE m.spend_bdt END
 ON CONFLICT(ad_account_id,spend_date,ad_id) DO UPDATE SET currency=excluded.currency,
  ad_name=excluded.ad_name,campaign_id=excluded.campaign_id,adset_id=excluded.adset_id,
  amount_spent=excluded.amount_spent,synced_at=excluded.synced_at,raw_payload=excluded.raw_payload;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION mis_internal.project_verified_marketing_spend(date,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION mis_internal.project_marketing_spend_change() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.source_payload->>'integration'='meta_ads_insights' THEN
  PERFORM mis_internal.project_verified_marketing_spend(NEW.date,NEW.meta_ad_id);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION mis_internal.project_marketing_spend_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER marketing_spend_compatibility_projection AFTER INSERT OR UPDATE ON public.marketing_daily_spend
 FOR EACH ROW EXECUTE FUNCTION mis_internal.project_marketing_spend_change();
SELECT mis_internal.project_verified_marketing_spend();

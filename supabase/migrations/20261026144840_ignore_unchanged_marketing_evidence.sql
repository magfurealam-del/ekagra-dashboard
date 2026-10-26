-- A revision represents changed evidence, not an attempted SQL statement.
-- Ignore empty writes and bookkeeping-only updates, while comparing every
-- business column (including future columns) and preserving transaction rollback.
CREATE FUNCTION mis_internal.mark_changed_marketing_evidence_dirty() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed boolean;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT EXISTS(SELECT 1 FROM new_evidence) INTO changed;
 ELSIF TG_OP='DELETE' THEN
  SELECT EXISTS(SELECT 1 FROM old_evidence) INTO changed;
 ELSE
  SELECT EXISTS(
   (SELECT to_jsonb(n)-'updated_at'-'updated_by' FROM new_evidence n
    EXCEPT ALL SELECT to_jsonb(o)-'updated_at'-'updated_by' FROM old_evidence o)
   UNION ALL
   (SELECT to_jsonb(o)-'updated_at'-'updated_by' FROM old_evidence o
    EXCEPT ALL SELECT to_jsonb(n)-'updated_at'-'updated_by' FROM new_evidence n)
  ) INTO changed;
 END IF;
 IF changed THEN UPDATE mis_internal.marketing_reconciliation_state SET revision=revision+1 WHERE singleton; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION mis_internal.mark_changed_marketing_evidence_dirty() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['crm_leads','lead_attribution','call_center_logs','referral_patient_report',
  'messenger_contacts','messenger_attribution_touches','meta_message_phone_candidates',
  'meta_call_center_reconciliation','patients','crm_appointments'] LOOP
  EXECUTE format('DROP TRIGGER mis_marketing_evidence_dirty ON public.%I',t);
  EXECUTE format('CREATE TRIGGER mis_marketing_evidence_insert AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_evidence FOR EACH STATEMENT EXECUTE FUNCTION mis_internal.mark_changed_marketing_evidence_dirty()',t);
  EXECUTE format('CREATE TRIGGER mis_marketing_evidence_update AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS old_evidence NEW TABLE AS new_evidence FOR EACH STATEMENT EXECUTE FUNCTION mis_internal.mark_changed_marketing_evidence_dirty()',t);
  EXECUTE format('CREATE TRIGGER mis_marketing_evidence_delete AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_evidence FOR EACH STATEMENT EXECUTE FUNCTION mis_internal.mark_changed_marketing_evidence_dirty()',t);
 END LOOP;
END $$;

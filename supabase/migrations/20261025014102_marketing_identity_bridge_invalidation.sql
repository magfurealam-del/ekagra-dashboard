-- Validating, revoking or correcting a patient-ID bridge changes source evidence.
-- Rebuild downstream attribution even when no new CSV is uploaded.
CREATE TRIGGER mis_marketing_identity_key_dirty AFTER INSERT OR UPDATE OR DELETE ON public.patient_identity_keys
 FOR EACH STATEMENT EXECUTE FUNCTION mis_internal.mark_marketing_evidence_dirty();

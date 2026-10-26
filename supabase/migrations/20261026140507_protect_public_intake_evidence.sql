-- Public forms create unverified requests. They cannot assert existing-patient
-- identity, invoice evidence, conversion proof, or validated ad attribution.
-- Preserve the existing source/status/date checks and trusted staff policies.
ALTER POLICY public_website_booking_insert ON public.crm_appointments
WITH CHECK (
 source_system='website' AND appointment_status='Pending'
 AND confirmation_status='Not Confirmed' AND appointment_date>=CURRENT_DATE
 AND patient_id IS NULL AND coalesce(visit_verified,false)=false
 AND visit_verified_at IS NULL AND visit_verified_by IS NULL
 AND matched_invoice_id IS NULL AND original_status_before_invoice IS NULL
);
ALTER POLICY public_website_interest_insert ON public.crm_leads
WITH CHECK (
 source_system='website' AND lead_status='Website Appointment Made'
 AND patient_id IS NULL AND coalesce(conversion_verified,false)=false
 AND conversion_verified_at IS NULL AND validated_meta_ad_id IS NULL
);

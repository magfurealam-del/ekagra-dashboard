-- Minimal synthetic-only source contract. Never contains production data.
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS secondary_phone text;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS lead_name text;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS phone_normalized text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS invoice_no text;
ALTER TABLE public.messenger_contacts ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.messenger_contacts ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.meta_message_phone_candidates ADD COLUMN IF NOT EXISTS phone_e164 text;
ALTER TABLE public.meta_message_phone_candidates ADD COLUMN IF NOT EXISTS phone_last4 text;
ALTER TABLE public.meta_message_phone_candidates ADD COLUMN IF NOT EXISTS direction_class text;
ALTER TABLE public.meta_message_phone_candidates ADD COLUMN IF NOT EXISTS meta_campaign_name text;
ALTER TABLE public.meta_message_phone_candidates ADD COLUMN IF NOT EXISTS first_seen_at timestamptz DEFAULT now();
ALTER TABLE public.meta_message_phone_candidates ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT now();
ALTER TABLE public.meta_message_phone_candidates ADD COLUMN IF NOT EXISTS source_event_ids uuid[] DEFAULT '{}';
ALTER TABLE public.meta_message_phone_candidates ADD COLUMN IF NOT EXISTS reconciliation_notes text;
ALTER TABLE public.meta_message_phone_candidates ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
ALTER TABLE public.meta_message_phone_candidates ADD COLUMN IF NOT EXISTS reconciled_by text;
ALTER TABLE public.meta_call_center_reconciliation ADD COLUMN IF NOT EXISTS review_notes text;
ALTER TABLE public.meta_call_center_reconciliation ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE public.meta_call_center_reconciliation ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.messenger_attribution_touches ADD COLUMN IF NOT EXISTS touch_type text DEFAULT 'referral';
ALTER TABLE public.messenger_attribution_touches ADD COLUMN IF NOT EXISTS source_event_id uuid;
CREATE TABLE IF NOT EXISTS public.messenger_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),psid text,page_id text,
 message_text text,received_at timestamptz DEFAULT now(),crm_lead_id bigint,webhook_event_id uuid);
CREATE TABLE IF NOT EXISTS public.meta_webhook_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),raw_event jsonb DEFAULT '{}');

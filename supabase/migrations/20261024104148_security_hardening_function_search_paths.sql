-- Pin the four advisor-flagged built-in-only functions to pg_catalog.
ALTER FUNCTION public.prevent_meta_delivery_payload_mutation() SET search_path = '';
ALTER FUNCTION public.normalize_messenger_phone_key(text) SET search_path = '';
ALTER FUNCTION public.set_meta_call_center_reconciliation_updated_at() SET search_path = '';
ALTER FUNCTION mis_internal.normalize_crm_source_group_v2(text) SET search_path = '';

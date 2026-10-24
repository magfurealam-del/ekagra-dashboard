-- Keep pg_trgm utilities out of the exposed public API schema. The only
-- database routine that directly calls similarity() uses a fixed path that
-- includes the extension schema after this move.
ALTER FUNCTION public.process_invoice_identity(bigint)
  SET search_path = public, extensions;

ALTER EXTENSION pg_trgm SET SCHEMA extensions;

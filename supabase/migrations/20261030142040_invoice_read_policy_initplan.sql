-- The stable, row-independent staff check retains identical authorization.
-- A scalar subquery lets PostgreSQL evaluate it once per statement, not per invoice row.
ALTER POLICY active_staff_read_invoices ON public.invoices
  USING ((SELECT public.is_active_staff()));
ALTER POLICY active_staff_read_invoice_line_items ON public.invoice_line_items
  USING ((SELECT public.is_active_staff()));

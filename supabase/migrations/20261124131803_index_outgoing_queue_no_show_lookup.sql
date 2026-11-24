-- The queue's recent-visit function probes this source by a text-normalized
-- ID for every open row. This partial expression index keeps the no-show
-- exception lookup bounded to the rows that can match.
CREATE INDEX IF NOT EXISTS idx_crm_appointments_no_show_source_id_text
ON public.crm_appointments ((id::text))
WHERE appointment_status = 'No-show';

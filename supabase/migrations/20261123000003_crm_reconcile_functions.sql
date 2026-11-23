-- Three piecewise reconciliation functions called after each MIS batch.
-- Each is idempotent and returns a count of rows it touched.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. crm_match_leads_by_phone
--    For leads with no patient_id, match via phone_normalized → patients.phone_e164.
--    Only sets patient_id when exactly one patient matches (avoids false positives).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_match_leads_by_phone()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  matched integer;
BEGIN
  WITH candidates AS (
    SELECT
      cl.id   AS lead_id,
      p.id    AS patient_id,
      COUNT(*) OVER (PARTITION BY cl.id) AS match_count
    FROM crm_leads cl
    JOIN patients p ON p.phone_e164 = cl.phone_normalized
    WHERE cl.patient_id IS NULL
      AND cl.phone_normalized IS NOT NULL
  )
  UPDATE crm_leads cl
  SET
    patient_id  = c.patient_id,
    updated_by  = 'crm_reconcile_phone',
    updated_at  = now()
  FROM candidates c
  WHERE c.lead_id     = cl.id
    AND c.match_count = 1;   -- unique match only

  GET DIAGNOSTICS matched = ROW_COUNT;
  RETURN matched;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. crm_backfill_lead_conversions
--    For leads that already have patient_id but missing first_invoice_id /
--    conversion_verified, find their earliest invoice and stamp conversion fields.
--    Runs after MIS uploads so new invoices are already in the invoices table.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_backfill_lead_conversions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  updated integer;
BEGIN
  WITH earliest AS (
    SELECT DISTINCT ON (cl.id)
      cl.id         AS lead_id,
      i.id          AS invoice_id,
      i.invoice_date
    FROM crm_leads cl
    JOIN invoices i ON i.patient_id = cl.patient_id AND i.net_bill > 0
    WHERE cl.patient_id IS NOT NULL
      AND (cl.first_invoice_id IS NULL OR cl.conversion_verified = FALSE)
    ORDER BY cl.id, i.invoice_date ASC, i.id ASC
  )
  UPDATE crm_leads cl
  SET
    conversion_verified    = TRUE,
    conversion_verified_at = COALESCE(cl.conversion_verified_at, now()),
    first_invoice_id       = COALESCE(cl.first_invoice_id, e.invoice_id),
    first_visit_date       = COALESCE(cl.first_visit_date, e.invoice_date),
    updated_by             = 'crm_reconcile_backfill',
    updated_at             = now()
  FROM earliest e
  WHERE e.lead_id = cl.id;

  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. crm_link_appointments_to_invoices
--    For visit_verified appointments that the old repair pipeline verified
--    without setting matched_invoice_id, find the matching invoice and link it,
--    then propagate patient_id / conversion fields to the parent lead.
--    Matches on: patient_id + invoice_date + doctor key (same logic as gateway).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_link_appointments_to_invoices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'mis_internal'
AS $$
DECLARE
  linked integer := 0;
  a      record;
  inv_id bigint;
BEGIN
  FOR a IN
    SELECT ca.id, ca.patient_id, ca.appointment_date, ca.doctor_service, ca.lead_id
    FROM crm_appointments ca
    WHERE ca.visit_verified = TRUE
      AND ca.matched_invoice_id IS NULL
      AND ca.patient_id IS NOT NULL
  LOOP
    -- Find a unique invoice: same patient, same date, doctor key matches
    SELECT i.id INTO inv_id
    FROM invoices i
    WHERE i.patient_id  = a.patient_id
      AND i.invoice_date = a.appointment_date
      AND mis_internal.doctor_match_key(i.consultant_name_raw) =
          mis_internal.doctor_match_key(a.doctor_service)
      AND i.net_bill > 0
    LIMIT 1;

    IF inv_id IS NOT NULL THEN
      -- Link the appointment
      UPDATE crm_appointments
      SET matched_invoice_id = inv_id,
          updated_by          = 'crm_reconcile_appt_link',
          updated_at          = now()
      WHERE id = a.id;

      -- Propagate to parent lead if it has one
      IF a.lead_id IS NOT NULL THEN
        UPDATE crm_leads cl
        SET
          patient_id             = COALESCE(cl.patient_id, a.patient_id),
          conversion_verified    = TRUE,
          conversion_verified_at = COALESCE(cl.conversion_verified_at, now()),
          first_invoice_id       = COALESCE(cl.first_invoice_id, inv_id),
          first_visit_date       = COALESCE(cl.first_visit_date, a.appointment_date),
          updated_by             = 'crm_reconcile_appt_link',
          updated_at             = now()
        WHERE cl.id = a.lead_id
          AND (cl.patient_id IS NULL OR cl.conversion_verified = FALSE);
      END IF;

      linked := linked + 1;
    END IF;
  END LOOP;

  RETURN linked;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. crm_reconcile_all  — master function called by the cron API route
--    Runs all three in the right order, returns a summary.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_reconcile_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r1 integer;
  r2 integer;
  r3 integer;
BEGIN
  r1 := public.crm_match_leads_by_phone();
  r2 := public.crm_link_appointments_to_invoices();
  r3 := public.crm_backfill_lead_conversions();

  RETURN jsonb_build_object(
    'phone_matched',       r1,
    'appointments_linked', r2,
    'conversions_backfilled', r3,
    'ran_at', now()
  );
END;
$$;

# MIS CSV source contract and reconciliation gates

Status (2026-10-24): **authority policy approved by the user**: treat each upload as authoritative for every included complete invoice. [The implemented contract and rollout](mis-upload-gateway-rollout.md) supersede the earlier proposed correction quarantine below. Invoice dates do not determine authority; accepted batch order does. Repeated identical bytes resume their original acceptance. The current implementation rejects a changed age reference year for the same file rather than silently reinterpreting it. The factual source-format analysis below remains applicable.

## Known source and target facts

- The approved CSV has 32 columns and identifies the invoice and item using `Invoice Id` and `Item Id`.
- The supplied `Report (4).csv` has 3,436 data rows, 1,531 invoice IDs, and invoice dates from 2026-07-15 through 2026-10-20. Its source date and `Invoice Datetime` fields both contain date-only values, not timestamps.
- Its first header is spelled `Doctors Deparment`; that exact export header is part of the accepted mapping. It contains blanks in department, admission, discharge, doctor, business-unit, marital-status, blood-group, and address fields, so those fields must remain optional in the parser contract.
- Monetary cells sometimes omit the leading zero (for example `.1441`). The parser now normalizes that form to `0.1441`, retains the raw cell unchanged, and still rejects exponent notation or more than four decimal places. The attached file parses with zero row validation issues using reference year 2026.
- This file has no repeated `(invoice_id, item_id)` pair. That is a fact about this sample only; it does not establish the key's uniqueness or correction semantics for future exports.
- The CSV has no stable source-line identifier, source revision, snapshot/delta marker, export coverage range, or completeness manifest.
- The live `public.mis_reports` table has a unique key on `(import_id, source_row_number)`, not on invoice-line identity. It contains multiple imports and therefore is not itself a current-version registry.
- Several target columns are `NOT NULL`, including patient name, age, birth year, phone, patient type, billing module, invoice-by, invoice date/datetime, parent/item type, item ID/name, and the monetary fields. Blank required values cannot be promoted safely by the current target schema.
- Identical rows can be legitimate repeated billed items. A byte hash identifies a repeated file; it does not prove that repeated business rows are duplicates.

## Safe v1 behavior

1. Preserve the original file and every nonblank source row. Parser failures and missing required target fields remain visible as validation findings; they are never replaced with zero, empty text, or a guessed date.
2. Require an explicit age reference year and persist it with the parse. Replaying the same bytes with a different year is a distinct parse version, not an implicit recalculation.
3. Treat an exact file SHA-256 repeat as a duplicate upload and do not repeat its import work.
4. Preserve repeated identical rows and their multiplicity. Report them for review; do not silently collapse them.
5. Do not infer corrections or deletions from absence. Existing invoices with changed rows are ambiguous until a trusted revision and line identity are supplied. Keep them staged for review.
6. Do not update `mis_reports`, `mis_report_imports`, finance, CRM, patient attribution, or dashboard tables from the upload/finalize request.

## Evidence required before canonical commit

Finance and the exporter owner must approve an executable contract containing:

- Facility/source namespace and invoice-key scope.
- Stable source line ID, or a signed-off alternative with proven behavior for repeated identical lines and line corrections.
- Monotonic source revision or equivalent authority evidence, including stale/equal-revision conflict behavior.
- Complete-invoice snapshot versus line-delta semantics, covered period, and a trustworthy completeness signal.
- Date/time zone and age reference-year rules.
- Financial definitions for gross/net/discount/collection/cancellation, expected rounding precision, and invoice-to-line validation tolerances.
- How invoice-number changes, patient reassignment, admission changes, deleted lines, refunds, and voided invoices are represented.

Until those rules exist, the preview may identify exact existing-row candidates, same-invoice changes, and new-invoice candidates, but every candidate must remain non-destructive and require review. Exact matches are not automatically discarded; missing rows are not tombstones.

## Planned promotion boundary

After source-contract approval, implement one server-only database transaction that accepts a sealed parse plus an unexpired preview digest and reviewer authorization. It must recheck source authority, source row counts, row identity, current invoice generation, and financial totals; then write a versioned canonical import and a durable downstream outbox event. A stale preview or unresolved invoice must abort before any canonical row is changed. The outbox, not the browser, starts the existing reconciliation worker.

The worker and publication gates remain separate from the canonical commit. Successful canonical promotion is not equivalent to successful finance reconciliation, CRM verification, lifetime attribution, or dashboard publication.


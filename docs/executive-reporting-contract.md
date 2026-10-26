# Executive dashboard reporting contract

## Interface and reporting

The dashboard uses official shadcn/ui (Radix Nova), Recharts, Tailwind and a bundled Geist font. Grouped navigation replaces horizontal overflow. Definitions, daily chart data, mobile navigation, keyboard focus and explicit errors support executive review.

`get_executive_dashboard(start, end, compare)` is an admin-only, read-only RPC. A single stable database read supplies overview, prior-period comparison, acquisition, team and ad reports. Custom ranges up to 366 inclusive days work without pre-existing snapshots. The report timestamp is distinct from the evidence-publication watermark. Pending reconciliation is disclosed. Historical comparisons reflect currently available evidence, not a frozen historical close.

## Definitions

- Contact dates use the original call-log date for migrated contacts; otherwise CRM creation date in Asia/Dhaka. Marketing evidence eligibility does not change a contact's date. Overview, source distribution and agent contact counts use this same population.
- Booking rate uses recorded intake outcomes within that contact population. A separate contact cohort counts distinct contacts with linked non-cancelled appointments and at least one eligible verified visit. Older cohorts have had longer to convert.
- Attendance eligibility excludes cancelled/rescheduled appointments and allows one complete Bangladesh calendar day after the appointment day for evidence. Today, yesterday and future appointments are not mature. This grace interval is a reporting convention, not a clinical SLA.
- Verified attendance requires a completed appointment, strict existing patient/date/physician evidence and unique use of a non-void invoice with positive billed value. This does not establish payment collection. Conflicting or reused evidence stays unresolved. Recorded no-shows require an explicit status and no conflicting exact evidence. No missing invoice is converted into a no-show.
- Eligible appointments partition into verified, explicit no-show and unresolved. Evidence coverage is verified / eligible. No-charge care remains unresolved until a separate clinical evidence source exists; it is never silently marked absent.
- CRM revenue uses invoice dates and valid, reconciled, non-void invoices with one unambiguous CRM lead owner. Identical links are collapsed. Revenue by source and agent uses the same invoice subset. The acquisition ledger includes patients without CRM contacts and displays its unattributed/historical portion separately. These populations must not be added together or treated as interchangeable.
- Workflow changes are events by change date, not distinct patients. Repeated events are never interpreted as patient coverage. Arbitrary good/warning/critical performance thresholds and the unrelated revenue/booked-lead ratio have been removed.
- Callback queue counts are as of the report read, independent of the selected period. Spend, CAC, ROAS and clinical no-charge outcomes are not invented from missing evidence.

## Access and deployment

The three executive reporting migrations are additive. They create private read views/helpers and one admin-guarded public RPC. They do not modify patient, appointment, billing, attribution or workflow records. Anonymous execution and direct authenticated access to private views/helpers are denied. The authenticated SECURITY DEFINER advisory is expected for this narrowly guarded admin RPC; role checks are covered by tests.

Migration filenames match the versions assigned by Supabase when applied. Source and tests include no production patient records, screenshots, account sessions or credentials.

## Verification

- PGlite regression suite: Bangladesh date boundaries, migrated contact dates, cross-section contact/attendance totals, shared denominator, cancellations/reschedules, evidence grace, duplicate evidence, no-charge/unresolved cases, invoice deduplication, empty/zero, prior periods, bounds and access controls.
- Presentation tests: Bangladesh midnight/month crossover, DST/leap-day prior windows, missing versus zero, inclusive range bounds and freshness.
- TypeScript and production Webpack build. Existing unrelated legacy lint debt is not represented as a clean repository-wide lint run.
- Live aggregate reconciliation verified matching contact totals, verified attendance and CRM revenue across sections. Materialized read populations avoid repeated evidence scans. No production patient records were changed for validation.

Rollback: return Vercel to the preceding production deployment. The additive reporting objects can remain unused; reverting the frontend does not require deleting database data or reversing clinical writes.

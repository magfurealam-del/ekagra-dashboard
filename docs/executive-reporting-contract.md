# Executive dashboard reporting contract

## Decision dashboard v3

The current interface calls `get_decision_dashboard(start, end, compare)`. This admin-guarded stable read retains the v2 populations and adds aggregate insights: date-aligned billed revenue and verified-visit trends, fixed-horizon contact cohorts, full open-queue aging, structured outbound attempt outcomes, evidence aging/reasons and source completeness. The private helper has no anonymous or authenticated execution grant; the public entrypoint explicitly rejects non-admins. The security advisor's authenticated SECURITY DEFINER finding is expected for this guarded aggregate endpoint and is covered by access tests.

Cohorts use distinct contact records, not unique patients. A contact is mature when contact date plus the selected 7/14/30-day horizon is at or before the attendance eligibility cutoff. Scheduled and verified visits must occur between the contact date and contact date plus the horizon, inclusive. This measures time to the scheduled visit, not the timestamp when booking was entered. Later or earlier appointments do not count toward that window. Evidence is evaluated as of the current report. Minimum linked visit dates are computed in one pass, rather than scanning appointments repeatedly for every horizon.

The queue is all open outgoing queue records, independently of the reporting range. Its age is measured from creation date, not a due date; missing or future dates are explicit. Evidence reasons and aging partition unresolved eligible appointments. Source-field completeness measures presence rather than truth. Ad period detail keeps contacts, all appointments, eligible appointments and acquisition-attributed billed revenue separate; its verified percentage uses eligible appointments.

The UI consolidates repeated charts, removes the free-text positive-outcome funnel and agent trophies, and provides exact values/data tables. Call performance includes confirmation calls and uses Bangladesh date presets. Scheduling mix and doctor hours are operational views, not utilization claims. Unsupported spend efficiency, collections and telephony metrics remain deferred. See `docs/decision-dashboard-plan.md` for the implementation plan.

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

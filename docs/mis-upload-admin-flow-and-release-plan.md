# MIS administrator upload and downstream processing plan

## Release candidate status (2026-10-23)

The repository now contains the `/admin/mis-upload` screen, an admin-only navigation link, a server-side active-admin guard, signed uploads to the private `mis-upload-source` bucket, SHA-256 verification, CSV parser integration, immutable staging RPCs, and a read-only upload-history endpoint. This release accepts **CSV only**; `.xlsx` workbooks are not accepted by the current parser. The API remains off unless `MIS_UPLOADS_ENABLED=true`, and the page enables the upload button only after the protected API confirms that flag. Set `SUPABASE_SERVICE_ROLE_KEY` only in the server environment; never as a `NEXT_PUBLIC_` variable.

Local parser tests, TypeScript, focused ESLint and an optimized webpack production build pass. Database migrations and RPC assertions have not been run against a disposable clone because no isolated database is currently available (the local Supabase container runtime is unavailable and branch creation was cancelled). Do not enable the flag or apply these migrations to production until the source branch includes a recoverable migration baseline, M00/M01/M02 and the read-only SQL assertions have passed on an isolated clone, active-admin/storage tests pass, and route-duration limits are verified on the Vercel plan.

The first release stages and quarantines rows for review only. It has no canonical MIS commit, invoice reconciliation, CRM/clinical verification, patient attribution, dashboard publication, worker queue, or cron activation. These downstream stages remain future work and must follow the sequence below.

## Intended first screen

Add an admin-only **MIS Uploads** item to the shared navigation at `/admin/mis-upload`. It sits beside Dashboard and Settings. The screen accepts the approved MIS CSV export in the first release; `.xlsx` support follows after workbook-specific formula, hidden-sheet, date-epoch, size and macro checks are implemented. The current parser is CSV-only, so the first release must label that clearly and reject `.xlsx` with an actionable message.

The page is a controlled workflow, not a generic file drop. It shows the accepted file type and size limit, the recognized export schema/version, the last successful upload, current queued/review state, and a clear warning that upload preserves evidence but does not itself change revenue, patient, CRM, or published dashboard data.

## User flow

1. An active admin selects or drops one file. The browser checks extension and size for convenience; the server repeats all security checks. No file is sent until the user confirms the selected name, size and last-modified value.
2. The browser obtains an authenticated upload reservation. The server verifies the Supabase bearer token with Auth, loads the user's current `user_profiles` row, and requires `role = admin` and `is_active = true`. It creates a random upload/attempt ID and a single-use object key. Actor identity, namespace, object path and idempotency key are server-controlled.
3. The original bytes go to a private Supabase Storage bucket with overwrite disabled. A failed or abandoned transfer remains distinguishable from a complete receipt; cleanup is a later, retention-aware operation and never deletes a referenced source.
4. Finalization downloads the stored object server-side, recomputes SHA-256 and byte count, and compares them with the reservation. Only the server-computed digest is authoritative. It records the immutable file receipt and upload attempt, then invokes the versioned parser.
5. The parser verifies UTF-8, exact approved headers, row widths, dates, amounts, limits and NUL/malformed CSV conditions. Raw cells and source row coordinates remain available. A parse failure retains the original file and records a stable error code; it does not create canonical rows.
6. Valid rows are staged in bounded idempotent chunks under an unsealed parse version. The server verifies total rows and rowset digest, then seals the parse. Database guards reject changes to receipts, sealed parses, raw rows, validation history and events.
7. The UI shows a receipt with counts: source records, blank records, valid rows, rejected rows, duplicate-file status and conflicts. It offers a protected detail/review page and a downloadable error report that is spreadsheet-safe. It never displays patient names or HNs in list views or logs.
8. In the first launch, the terminal state is **Ready for review** or **Needs review**. There is no “Apply to MIS” action until line identity, revision/completeness, cancellation/refund and collection semantics have approved fixtures and a transactional canonical commit/outbox migration. A reviewed future commit runs as a separate, audited action and is not part of upload/finalization.

## End-to-end system after intake

```mermaid
flowchart LR
  Admin[Active admin] --> UI[Admin MIS Uploads]
  UI --> Auth[Authenticated reservation API]
  Auth --> Bucket[Private immutable source object]
  Bucket --> Finalize[Hash verification and receipt]
  Finalize --> Parser[Versioned bounded parser]
  Parser --> Raw[Append-only raw rows and parse]
  Raw --> Validate[Schema and business validation]
  Validate --> Review[Preview, conflicts, explicit review]
  Review --> Commit[Future approved invoice commit + outbox]
  Commit --> Reconcile[Generation-based invoice reconciliation]
  Reconcile --> Clinical[Clinical evidence and CRM verification]
  Clinical --> Attribution[Patient lifetime attribution]
  Attribution --> Publish[Validated publication pointer]
  Publish --> ReadModels[Admin finance and patient read models]
```

Downstream execution must preserve these boundaries:

| Stage | Required contract | User-visible result |
|---|---|---|
| Validation | Each source row is accounted for as valid, blank, rejected, duplicate or conflict. Unknown headers/mappings and missing mandatory finance values fail closed. | Totals reconcile to source row count; errors can be downloaded safely. |
| Deduplication | Raw-file SHA deduplicates exact bytes only. Business line identity is a separate, evidence-backed key. Arrival time and filename do not determine correction authority. | Duplicate file is linked to its original receipt; conflicting candidates remain reviewable. |
| Preview | Pin parser/schema/rules version and source authority evidence. Show proposed invoice-level changes, both old/new totals and affected patient/admission periods. | Reviewer sees a deterministic diff and why each row is accepted, quarantined or unchanged. |
| Canonical commit | One transaction applies whole-invoice source versions and creates an outbox generation. A stale preview fails compare-and-swap. No ownership filter drops unchanged lines from earlier sources. | Commit ID, reviewer, evidence and changed invoice list are auditable. |
| Reconciliation | Bounded durable jobs process all affected invoices, old/new date windows, admissions, patient identity and CRM dependencies. Workers use leases, fencing, idempotent batches and resume checkpoints. | Queue states distinguish waiting, running, deferred, failed, review and complete. |
| Clinical/CRM | Only approved source and clinical evidence can verify attendance or therapy. A bill, package sale or manual completion label alone is insufficient. Patient origin uses earliest authenticated eligible contact and signed financial definitions. | Unresolved cases remain visibly excluded from verified counts/attribution. |
| Publication | Candidate finance, CRM and patient generations pass signed totals and dependency checks before an atomic pointer changes. Existing Vercel/pg_cron/manual refreshes must obey the same gate. | Dashboard names the publication run and keeps the last known-good run when any stage fails. |

## Implementation sequence and migration boundaries

| Step | Code/database deliverable | Gate before next step |
|---|---|---|
| 0. Reproducible baseline | Restore or formally replace the missing migration sources; capture exact live function, grant, trigger, policy, storage and schedule definitions. Create a disposable database seeded from a schema-faithful snapshot. Keep live fingerprints/private source profiles outside the public PR. | Local migration ledger can explain every live schema object; clone restore is proven. |
| 1. Authorization | Audit all profile and admin consumers. Protect role/active/password fields. Keep privileged code in `mis_internal`; public RPCs are invoker wrappers and expose only narrow operations. Add server-side `requireActiveAdmin` that verifies the bearer token and fresh database role. | Clone tests prove agent/self-role elevation is denied, admin access works, profile self-service remains valid and function grants are least-privilege. |
| 2. Immutable intake schema | Apply the existing M01 staging tables/guards on the clone. Add state-transition and upload RPCs with explicit grants, idempotency, append-only attempt events, safe failure recording and rowset sealing. | Assertions cover direct-table denial, state transition graph, duplicate hash race, immutability and rollback. |
| 3. Storage and API | M02 creates a private bucket with a byte cap, no public listing/read, no client delete/overwrite, and server-only finalization. Add `POST /api/admin/mis-uploads/reserve`, `POST /api/admin/mis-uploads/[id]/finalize`, `GET /api/admin/mis-uploads`, and protected detail/error endpoints. Keep request byte limits and route duration inside the verified Vercel plan limits. | Adversarial auth, object-path, replay, partial upload, hash mismatch, oversized file and orphan cleanup tests pass on clone/preview. |
| 4. Admin UI and CSV parsing | Add `/admin/mis-upload`, upload history/detail/review states, explicit confirmation, progress/retry and safe error export. Use the deterministic parser; CSV only for v1. No canonical write in this step. | Admin/non-admin E2E flows pass; failed parses retain source evidence; all row counts/digests reconcile. |
| 5. Source contract, preview and review | Obtain finance/exporter signoff for stable line grain, revision/as-of semantics, complete snapshot vs delta, void/refund and collection meanings, timezone/date/reference-year rules and patient identity. Build reproducible whole-invoice proposed diffs. | Synthetic/approved-fixture tests prove order independence, stale/conflict handling and exact signed totals. Until then, only stage/review. |
| 6. Canonical commit and outbox | M03/M04 add authoritative line versions, source registry, invoice heads, compare-and-swap preview commits and one durable outbox in the same transaction. Legacy-trigger coexistence is explicitly routed. | No source change can commit without its work generation; no old import owner filter drops lines; rollback is rehearsed. |
| 7. Workers and downstream projections | M05–M08 add bounded overnight leases/batches, complete affected invoice closure, CRM/clinical evidence, lifetime attribution, generation-pinned read models and health/alerts. Existing schedules stay unchanged until load tests and explicit activation plan pass. | Overnight replay finishes with headroom; no false verified visits, lost corrections or mixed dashboard generation; two-night shadow observation passes. |
| 8. Production rollout | Review/merge code, stage schema without assigning production domains if applicable, verify preview, take/verify backup, apply reviewed migrations one at a time, run post-migration assertions, deploy the exact tested Vercel commit, run canary upload/preview, then separately enable canonical commit and schedules. | Release owner, finance, CRM and database owners sign the same build/schema/publication evidence; rollback/restore owner is present. |

## Release and rollback rules

- The first usable production release is **immutable CSV intake and review only**. It may not update `mis_reports`, invoices, admissions, clinical verification, CRM attribution, dashboards or schedules.
- Original object bytes are retained with a server-computed hash; parser changes create new parse versions. No replacement or deletion endpoint exists for uploaded evidence.
- Feature flags default off. Deploying application code does not activate write RPCs. Migrations are additive and ordered; no fake `migration repair` entries may conceal the live history gap.
- Rollback disables the intake UI/API flag and routes but keeps receipts, source objects and history. Database rollback uses a reviewed forward fix or restore drill; it never erases accepted evidence or restores insecure self-role grants.
- Never enable the reconciliation worker or alter cron schedules in the intake PR. Schedule changes are a later, separately reviewed release with an exact prior schedule manifest.

## Deployment-readiness checklist for this repository

- [ ] Resolve the 601 live migration versions without local sources and produce a repeatable schema-first clone.
- [ ] Run M00/M01 and upload RPC/storage tests on that clone; verify `mis_internal` is absent from PostgREST's exposed schemas.
- [ ] Implement the API/UI above; verify server-side active-admin checks and keep service-role credentials out of browser bundles.
- [ ] Prove upload hash, rowset hash, byte/count reconciliation, duplicate idempotency and append-only guards.
- [ ] Obtain the MIS source-contract decisions before adding canonical commit behavior.
- [ ] Run focused and full tests, production build, preview E2E, security checks and database advisors; record the exact tested commit and schema fingerprint privately.
- [ ] Keep production data and cron schedules unchanged until the release candidate passes and the rollout checklist is reviewed.

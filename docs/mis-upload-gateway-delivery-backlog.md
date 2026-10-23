# MIS Upload Gateway — delivery backlog

Status: **planned, not implemented**. Production changes require subsequent explicit approval. This backlog targets the inspected `magfurealam-del/ekagra-dashboard` checkout and Supabase project `youqgrwovfyqqsnbtcnm`. Do not deploy or apply every pending local migration: the checkout is dirty, local/applied IDs diverge, and live October migrations are absent locally.

References: [architecture and migration contracts](mis-upload-gateway-implementation-plan.md), [test matrix and SQL gates](mis-upload-gateway-test-matrix.md).

## Minimal first implementation PR

Suggested title: **Preserve MIS source receipts and establish a reproducible upload baseline**.

Deliver a local, reviewable foundation with no production activation:

1. Add `scripts/mis-upload/audit-baseline.ts` with hardcoded production-read-only mode and an explicit separate clone allowlist for write tests. Export schema/function/trigger/grant/cron/migration metadata hashes into `docs/database-baseline/`; no PII or credentials. Include original file count/hash manifest and overlap profiler. Recover exact October migration definitions into a documented baseline rather than copying old September worker SQL over production.
2. Add synthetic 32-column CSV fixtures, a deterministic CSV parser/normalizer under `lib/mis-upload/`, pinned `csv-parse`/decimal arithmetic dependency and unit tests. No UI/API uploader yet. Real legacy files remain outside Git and are loaded only from an explicit local path.
3. Create M00 `protect_profile_authorization_fields`: protect role/is_active and other authorization-control fields with column grants and a tested privileged role-management path; preserve allowed profile self-service behavior. Do not deploy this change in planning or without normal approval. This is a prerequisite for trusting admin authorization, not an unrelated refactor.
4. Create M01 `mis_upload_immutable_intake`: private receipt/state/attempt/parse/rows/validation tables, immutable guards and restricted grants. Test on a clone only. No production bucket, no attachments to `mis_reports`, no canonical updates, no worker/cron changes.
5. Add server flags default false and document the migration ledger mismatch and remaining source identity/revision/completeness decisions. The first PR must not claim upload/reconciliation is usable end-to-end.

First PR acceptance: baseline replay demonstrated on isolated DB; profile self-promotion denied and legitimate updates work; source bytes/counts deterministic; immutable-row tampering denied; no finance/CRM/source rows touched by migrations; all flags off; no real source files/secrets in diff. If the baseline cannot yet replay, submit only the audit/contract portion and mark M00/M01 blocked rather than pretending a deployable migration chain exists.

## Effort scale and ownership

S = approximately 0.5–2 engineer-days; M = 2–5; L = 5–10; XL = 10–20+, usually split. These are implementation/review bands, not elapsed-time promises. Historical schema recovery, business contracts and production approvals can dominate calendar time. Owners are functions, not invented staff assignments. Security, finance and CRM owners sign off on their acceptance gates; backend/database ownership stays accountable for the end-to-end invariant.

## Sequenced tickets

| ID / milestone | Work and actual target | Owner / effort | Depends on | Definition of done |
|---|---|---|---|---|
| GW00 / P0 | Capture repo HEAD/dirty state; reconcile applied ledger against `supabase/migrations/`; export exact live core/October functions, grants, indexes, policies, triggers, cron definitions; build sanitized clone bootstrap | DB architect / L | None | Reproducible baseline with schema hashes and known external dependencies; no live history repair or source changes; test G0 |
| GW01 / P0 | `scripts/mis-upload/profile-source.ts`, fixture manifest; independently profile Downloads files and normalized overlapping changes | Data engineer / M | GW00 | Original hashes/counts verified; raw≠normalized differences distinguished; failed import2 separately assessed; P01/P02/C19 |
| GW02 / P0 | Versioned source contract under `lib/mis-upload/schema.ts`; exporter/finance confirms line grain, authority revision, snapshot/delta, completeness, cancellation and collection semantics | Finance + upstream owner + DB / M plus external dependency | GW01 | Written executable schema and rejection rules; unknown evidence defaults to quarantine, not guessed authority |
| GW03 / P0 | M00 profile grants/RPC; audit all role-granting paths and source PII access; `lib/server/misUploadAuth.ts` design | Security + backend / M | GW00 | S01–S05 pass; self-role elevation denied without breaking legitimate profile/admin workflows |
| GW04 / P1 | M01 immutable intake schema/guards/attempts/validation; `supabase/migrations/` generated via CLI | DB / M | GW00/GW03 | Raw history append-only, FK/unique/default grants verified; P16–P20; no source trigger changes |
| GW05 / P1 | Exact CSV parser/decimal normalization and synthetic fixtures; package scripts/lockfile | Backend / M | GW02 | P01–P08/P12/P14 pass; lexical raw values retained; replay independent of current year/row order |
| GW06 / P1 | XLSX preflight and lexical numeric extraction; bounded ZIP/XML + ExcelJS metadata; optional .xls explicitly rejected | Backend + security / L | GW05 | P09–P11 and parser memory/CPU tests pass; no formula/cache/hidden-sheet silent behavior |
| GW07 / P1 | M02 private Storage provisioning/policies; reservation/finalize/download APIs under `app/api/admin/mis-uploads/`; durable parse dispatch and recovery | Backend + platform / L | GW03/GW04/GW05/GW06 | TUS upload, checksum seal, failed-object recovery, protected downloads, no proxy of large bytes; P15–P19/S06/S07 |
| GW08 / P2 | M03 key/version/authority/preview/commit/head registry; optional NULL/year/timestamp compatibility; observed legacy baseline seed | DB / L | GW00/GW02/GW04 | Stable IDs/money preserved; original history and canonical observed history separated; future-date/NULL tests; C19 |
| GW09 / P2 | Restore original file receipts/rows for1/3/4 after approval; inspect failed2; discrepancy report only, no automatic replay | Data engineer + finance / M | GW07/GW08 | Original count equality restored in immutable ledger; legacy current ownership unaffected; auditable originals linked by SHA |
| GW10 / P2 | Preview/decision/authority workflow and proposed canonical diff; protected errors | Backend + finance / L | GW02/GW08 | Exhaustive row-accounting partition, per-invoice quarantine, stale preview handling; no unordered correction commit |
| GW11 / P2 | M04 serializable commit/outbox; gateway vs legacy trigger routing; idempotency and sorted locks | DB / L | GW08/GW10 | C01–C08/C16–C20 pass; no canonical write without work; final atomic merge meets 30 s hard bound |
| GW12 / P3 | M05 generation queue/leases/fencing/attempts; `process_gateway_batch` and authenticated RPC wrapper | DB + backend / L | GW11 | Whole canonical invoices from pinned versions; no import-owner filtering; W01–W10 and actual hard timeout verification |
| GW13 / P3 | Rewrite dimension/line correction adapters; stable line ID mapping, tombstone effects, shared trigger guard audit, both-owner/date/admission closure | DB + finance / XL | GW12 | C09–C15/C21 pass; catalog/identity conflicts explicit; signed totals exact; no lingering old financial/CRM links |
| GW14 / P3 | M06 shared clinical evidence qualifier and source-based conversion rules, versioned encounters | CRM + DB / L | GW13 | E01–E07; no medicine/package/manual-label false visits; unresolved 274/278 cases not swept away without evidence |
| GW15 / P3 | M06 patient acquisition/attribution/contact history generation; bridge positive/signed financial definitions | CRM + data engineer / L | GW14/GW02 | A01–A07; earliest authenticated eligible source, same-day uncertainty, no pre-source credit or double counting;12identity conflicts remain explicit |
| GW16 / P3 | Bounded runner `app/api/cron/mis-upload-worker/route.ts`; validate actual 60 s runtime, transport timeout, durable acknowledgement; no cron activation | Backend + platform / M | GW12/GW13 | max 45 s work/up to 30 distinct transactions; leases/cutoff tested; no fire-and-forget assumptions |
| GW17 / P4 | M07 publication run/pointer/read models and acceptance views; generation guards for all finalizers and manual refresh | DB + frontend / XL | GW14/GW15 | D01–D07; whole-page publication ID pin; no mixed snapshots; financial/open-review distinction |
| GW18 / P4 | Upload list/detail UI under `app/admin/mis-upload/`, `components/mis-upload/`; admin navigation and protectedAPI wiring | Frontend + backend / L | GW07/GW10/GW11/GW17 | Honest states/counts, preview/commit/errors/downloads, next eligible window and last good source coverage; E2E role tests |
| GW19 / P4 | Migrate `app/admin-dashboard/page.tsx` and `app/patients/[id]/page.tsx` reporting reads; inspect other deployed finance consumers | Frontend + CRM + finance / L | GW17 | New RPC/read models actually consumed; legacy operational workflows still work; source attribution labels match definitions |
| GW20 / P4 | M08 health/status RPC, generation metrics, flags, PII-safe alert integration and on-call runbook | Platform + DB / M | GW16/GW17 | Dispatch vs business outcome visible; stale/failed/deferred separate; alert delivery tested after destination authorization |
| GW21 / P5 | Clone replay/performance suite, real-file private regression and full canary rollback drill | QA + DB + finance / L | GW09/GW11–GW20 | All G0–G4 gates; full replay has 20% window headroom; CRM latency within target; restore duration recorded |
| GW22 / P5 | Audit effective Vercel and pg_cron schedules, including 09:00 Dhaka correction; M09 approved activation migration and exact inverse schedule manifest | Platform + DB / M | GW21 + explicit production approval | Existing15min cadence, bounded callbacks, no overlapping legacy consumer, all readers guarded; actual executions observed |
| GW23 / P5 | M10 private production canary: immutable intake first, then approved small commit, historical correction, validated publish | Release owner + finance + CRM / M | GW22 + backup/rollback approval | Same invariant suite on canary, no surprise patient attribution/visit changes; signed rollups reviewed; source files retained |
| GW24 / P5 | Two-night observation, expand safely; M11 retire proved-unused legacy paths and redundant scans | Platform + DB / M | GW23 | Verified business success and recovery, no one-minute cron, no provenance deletion, documented consumer ownership |

## Full execution sequence and checkpoints

1. **P0: establish facts and contract.** GW00–GW03; preserve existing dirty checkout. Confirm source identity and correction authority before automatic canonical acceptance. Obtain exact missing October schema/migration definitions. Do not overwrite live newer code with old local worker migrations.
2. **Foundation PR:** GW00/GW01/GW03/GW04 plus offline CSV portion of GW05. Review locally, no deployment/schedules. If a baseline blocker remains, ship only read-only evidence tooling and contract documentation first.
3. **P1: upload and immutable staging.** GW05–GW07; source-only intake, flags off until security gates. Original file snapshots survive parse failure. No canonical mutation while source model is incomplete.
4. **P2: source identity and commit.** GW08–GW11; implement registry/authority/preview, test legacy trigger coexistence and atomic outbox. Original-history backfill is separately approved data work. Clone replay must not use arrival order as revision authority.
5. **P3: reconciliation.** GW12–GW16; exact affected closure, shared clinical evidence and lifetime patient source; separate transaction batches and verified host limits. New and legacy consumers must never own the same gateway invoice work simultaneously.
6. **P4: publish and operate.** GW17–GW20; versioned read models before UI read switch, both scheduled/manual snapshot paths gated, operational health and deferred states. Confirm new UI actually consumes corrected attribution.
7. **P5: tests and rollout.** GW21–GW24; measured capacity/restore drill, then separately approved schedule activation and controlled production canary. Expand only after two nights and a historical correction succeed. Preserve all rollback evidence.

Implementation sessions must create migration filenames through Supabase CLI, record actual resulting IDs, and add them to this checklist. No timestamp in this document is an instruction to repair the live migration ledger. Each PR must state clone tests, production preconditions, schema hash, forward migration, safe rollback path and feature-flag state.

## Decisions requiring evidence rather than guessing

| Dependency | Why tooling cannot settle it now | Safe default / owner |
|---|---|---|
| Stable line identity | Sample uniqueness does not prove future repeat-service/export semantics | No auto-merge of ambiguous repeats; exporter + finance |
| Trusted source revision/completeness | Inspected32-column CSV has neither version nor manifest | Quarantine conflicting corrections; finance-reviewed authority ledger or upstream revision contract |
| Signed cancellation/collection meaning | Values alone do not establish whether cancellation overlaps refund or payment timing | Separate financial measures; finance signs rules and fixtures |
| Effective deployment/runtime/consumers | Local Vercel config and database connectors do not prove deployed build/runtime or all finance dashboards | Verify before worker/read switch; platform owner |
| Retention/PITR/malware runtime | No approved duration/restore proof or scanning service inspected | Retain source, no launch until operational gate; privacy/platform |
| GitHub/production write permissions | No push/deploy attempted; earlier access issues are not assumed current | Verify branch/PR rights before implementation delivery; explicit production approval remains required |

## Risks and release vetoes

* **Critical authorization:** role self-update undermines uploader authorization. M00 and role-management tests precede any uploader exposure.
* **Critical financial history:** import ownership is mutable; overwriting declared counts/fingerprints would erase evidence. Source history and canonical versions must be separate.
* **Critical corrections:** partial invoice rebuilds, latest-import authority and stale repair links can quietly corrupt finance and patient attribution. Complete-invoice generation tests are mandatory.
* **High throughput:** current one-batch/15minute worker plus100-invoice repair cap cannot be assumed to finish historical imports overnight. Measure whole pipeline, not just core tick time.
* **High publication:** current snapshots/manual paths are not generation gated; fresh-looking dashboards can contain mixed old/new facts. Do not switch reporting before barrier tests.
* **High clinical:** positive billing, package sale and manual Completed are insufficient visit evidence. Unresolved reviews must remain visible; gate false-positive verification at zero.
* **High delivery drift:** applying local pending migrations blindly could regress newer live schema. Baseline reconciliation is a release veto, not deferred housekeeping.

Production readiness is reached only when G0–G5 in the test matrix pass, the rollback owner has a verified restore/schedule manifest, and finance/CRM sign off on the same candidate publication. No production implementation has occurred in this planning task.

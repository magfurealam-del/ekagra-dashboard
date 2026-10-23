# MIS Upload Gateway — test matrix and acceptance gates

Status: **test design only; no implementation tests or production mutations performed**. Read-only baseline checks and CSV profiling were performed on October 22 US / October 23 UTC, 2026. See [implementation plan](mis-upload-gateway-implementation-plan.md) for inspected findings and proposed object contracts; [backlog](mis-upload-gateway-delivery-backlog.md) assigns delivery ownership.

## 1. Harness, environments and evidence

Implement TypeScript parser/unit tests with Vitest, database migration/RPC tests with pgTAP or isolated PostgreSQL integration tests, and Playwright for browser authorization/upload/status flows. Pin versions during implementation. Use a sanitized, schema-faithful clone with real constraints, grants, policies and triggers; an empty mock table cannot test this pipeline. Add `test:mis:unit`, `test:mis:db`, `test:mis:e2e`, `test:mis:replay` scripts to the actual repository `package.json`. DB tests require an explicit nonproduction project allowlist and fail closed if project ref equals production.

Production planning checks are SELECT-only. Do not execute a mutating RPC inside a “read-only test” or rely on a transaction rollback to make production testing acceptable. Cron/window tests inject a controlled clock into a private test-only harness on the clone; production must not expose a bypass parameter or client-settable business-hours exemption.

For each test save sanitized fixture digest, schema/parser/rules version, source generation, test actor role, expected/actual counts and money measures, timing, and failed invariant. Do not commit real patient CSVs, database dumps, tokens or error exports to Git. Synthetic fixture names below are proposed files under `tests/fixtures/mis-upload/`.

### Baseline fixtures

| Fixture | Evidence available | Use / oracle |
|---|---|---|
| `legacy-report-1` | Local `Downloads/Report.csv`, 20,121 records; hash `5b8593dce2b993125ee6b53eee585a08c1b7f60f668d44551d3c843be39838e5` | Private local replay, immutable count/hash; no production replay |
| `legacy-report-3` | `Report (3).csv`, 5,513; hash `68f090e11c3d97f0dc88abbe252aceac97f1a30ecf6ca38caed0f3df2ae4096e` | Overlap/correction proposal comparison |
| `legacy-report-4` | `Report (4).csv`, 3,436; hash `77343acfab3dc85de06043b5620d488494ee7033eb465d4ce7b2ca4ef0f1d54a` | Recent import and full-invoice reconciliation |
| `legacy-failed-2` | `Report (1).csv` exists; live import 2 is failed with 2,674 declared and zero owned rows; bytes not profiled in this phase | Recover/verify separately; do not assume failed import contains no valid evidence |
| `synthetic-base.csv/.xlsx` | Same approved 32-column schema; 3 patients, 5 invoices, 12 lines, two admissions, signed refund, optional blanks | Hand-calculated exact expected line, invoice, collection and attribution totals |
| `synthetic-corrected-v2` | Same stable line IDs, explicit source revision 2 and evidence | Correct old amounts/patient/date/void; authoritative order independence |
| `synthetic-legacy-ambiguous` | No source revision or stable line ID, conflicting invoice/item candidate | Must quarantine, not reproduce a guessed current state |
| `synthetic-clinical-evidence` | Consultation, medication only, package sale, clinical zero-price service, duplicate bookings, multi-day IPD | Positive and negative visit/source controls |

Legacy raw pair overlaps 1/3=1,739; 1/4=179; 3/4=547. Financial **text** changes are 1,216 / 179 / 279; normalize decimal strings before numeric-difference assertions. These fixtures do not establish legitimate repeated-detail-line semantics; use explicit synthetic repeated lines and upstream contract evidence.

## 2. Parser and immutable intake tests

| ID | Input / action | Required behavior and assertion | Layer |
|---|---|---|---|
| P01 | Valid 32-column CSV with BOM, CRLF, quoted commas/newlines | Preserve all cell lexemes/row coordinates, exact record count and raw-byte SHA; no auto-cast | Unit/integration |
| P02 | Same data, reordered rows/headers using approved schema mapping | Same business payload set; source rowset hash can differ; canonical no-op if authority/payload identical | Unit/DB |
| P03 | Unknown/missing/duplicate header, misspelling not approved | Reject before canonical preview; name offending header safely; allow actual `Doctors Deparment` only via registry | Unit/E2E |
| P04 | Known DD/MM date, ambiguous undeclared date, 31/02, leap day | Known 01/02 means February 1; undeclared ambiguous format quarantines; invalid date rejected | Unit |
| P05 | Excel 1900/1904 dates, fake 1900 leap day, time fractions | Correct declared epoch only; fake date rejected; original precision/timezone retained, no fabricated midnight event | Unit |
| P06 | Age `35Y 3M 21D`, blank/NULL, impossible age | 35 / 1991 with reference year 2026; blank remains NULL; replay in 2027 unchanged | Unit/DB |
| P07 | Empty phone/name/gender, HN leading zeros, blank required key | Optional blanks NULL without fake text; required identities quarantine whole invoice; leading zeros retained | Unit/DB |
| P08 | -1.0050, 0, missing, large amounts, >4dp, exponent syntax | Exact decimal policy, no floats, zero != missing, overflow/unsupported precision rejected; named rounding deltas | Unit/DB |
| P09 | Financial formula cell with cached numeric result | Reject formula under v1; do not evaluate/use cache as authority | Unit/security |
| P10 | Hidden populated sheet, merged data cells, multiple candidate sheets | Reject/quarantine with sheet-level reason; no silent ignored source rows | Unit |
| P11 | Corrupt ZIP, archive bomb, external links/entities, encrypted/macro file, disguised extension | Reject under bounded CPU/RAM/expanded size; no outbound parser requests, no formula/macro execution | Security/performance |
| P12 | CSV field exceeding bound, malformed quotes, truncated row | Fail parse; raw object retained; no canonical changes | Unit/integration |
| P13 | Syntactically valid truncated invoice/export | Without trusted completeness evidence cannot tombstone or certify coverage; whole-file commit blocked when declared counts mismatch | DB |
| P14 | Formula-like values in error CSV/download | Error export spreadsheet-safe; original object bytes/hash untouched, attachment content type safe | E2E/security |
| P15 | Upload disconnect, partial object, checksum spoof, retry finalization | Unsealed/retryable state, verified server hash required, no double receipt/parse | Integration |
| P16 | Identical file twice and 20 simultaneous uploads | One sealed namespace/hash receipt, one canonical effect, attempt per request; losers reference winner; abandoned objects tracked | Concurrency |
| P17 | Parser crashes after staging 1,000 of N rows | Chunk retry same PK+digest no-op; differing replay chunk rejected; no seal until total+rowset hash verified | Integration |
| P18 | Parser version upgrade of same bytes | New parse version; prior rows/hash/results unchanged; explicit re-preview, no duplicate money | DB |
| P19 | Source object overwrite/delete, raw row UPDATE/DELETE | Denied for browser/server app roles; attempted action audited; owner privileges excluded from WORM claim | Security |
| P20 | Optional blanks reach old NOT NULL fields | Compatibility migration handles allowed NULL; mandatory money gaps quarantine; never coalesce unknown to zero | Migration |

## 3. Canonical commit, identity and correction tests

| ID | Scenario | Expected oracle | Layer |
|---|---|---|---|
| C01 | No-op overlapping file with same payload | No canonical IDs/versions/amounts change; lineage decision retained; no changed-invoice jobs | DB |
| C02 | A revision 1 then B revision 2, reverse order, concurrent | Identical final authoritative state; stale lower revision no-op; row histories reflect actual receipt order without changing final truth | DB/concurrency |
| C03 | A/B conflict with absent/equal authority | Both raw files retained; conflict visible; no automatic last-upload-wins; explicit reviewed resolution version | DB/E2E |
| C04 | Same invoice/item twice: two legitimate charge events | Distinct proven line IDs survive; legacy ambiguous key quarantines rather than collapsing charges | Unit/DB |
| C05 | Identical repeated raw row under different templates | Only a template declaring accidental duplicate semantics may dedup; detail template preserves or requires line IDs | DB |
| C06 | Same invoice conflicting HN/date/header | Whole invoice quarantined; no first-row-wins header | DB |
| C07 | Correct one line in invoice whose other lines originated in older files | All unchanged canonical lines retained; full invoice totals exact; no import-owner filter | DB |
| C08 | Certified snapshot omits line versus uncertified partial export | First retires proven omitted line with audit; second cannot delete it | DB |
| C09 | Correct prior-year invoice after completed reconciliation | New generation queues old period; finance, CRM and patient lifetime recompute beyond 45 days | Integration |
| C10 | Move invoice to another patient/date | Old patient's revenue/visit/origin removed when unsupported; new owner consistent; old/new date windows invalidated | Integration |
| C11 | Correct invoice number with explicit old→new lineage | Old/new keys reconciled once; stable logical identity mapping; no double billing; absent lineage quarantines | DB |
| C12 | Void/refund/cancel, negative collection, restored invoice | Signed totals exact, positive billing/refund bridge distinct, outdated attendance revoked, audited re-verification possible | DB/integration |
| C13 | Admission spanning months, corrected discharge/NULL date | One verified episode, census months invalidated; no coalesce that preserves withdrawn discharge; no extra patient visits | Integration |
| C14 | New HN versus same phone/two HNs, conflicting name | Unambiguous new source HN may create patient; conflicting normalized HN quarantines; phone never auto-merges | DB |
| C15 | Product code matches multiple catalog IDs | Financial source preserved but mapping review required; no arbitrary min-ID selection or silent service identity | DB |
| C16 | Failure after canonical UPDATE before enqueue | Entire transaction rolls back: no source mutation without work; staging remains | Fault injection |
| C17 | Response lost after transaction commit | Same idempotency key returns prior commit/work references; no duplicate versions/jobs | Fault injection |
| C18 | Two admins commit same stale preview or crossing keys | Lock/CAS serializes; stale preview returns409; bounded retry; no lost correction | Concurrency |
| C19 | Historical provenance backfill | Imports1/3/4 restored at original counts; current canonical amounts/IDs/ownership unchanged; legacy observed versions labelled honestly | Migration/replay |
| C20 | Gateway commit meets legacy import trigger | Gateway path produces one outbox set; old count-based trigger is bypassed by trusted intake-kind routing only; legacy still works | Migration |
| C21 | Changed clinical mapping/rules without source edit | New rules generation requeues relevant dependencies; no reliance on import ID changing | Integration |

## 4. Workers, CRM, attribution and publication

| ID | Scenario | Required assertion |
|---|---|---|
| W01 | Crash before/after batch commit | Atomic invoice result or no effect; retry does not multiply lines, events, attribution or doctor shares |
| W02 | Two cron dispatches / delayed old owner | One facility lease; fenced token rejects old owner; no duplicate completion |
| W03 | Lock timeout/statement cancellation | Bounded abort, durable attempt category, checkpoint unchanged; no hung transaction beyond hard limit |
| W04 | 00:14:59 / 00:15 / 07:44:59 / 07:45 Dhaka | Downstream writes only within half-open window; insufficient remaining budget defers; crossing cutoff rolls back |
| W05 | Long transaction with `now()` frozen | `clock_timestamp` detects cutoff; test rejects reliance on function-level timeout settings alone |
| W06 | Retry exhausted, data error, oversized invoice | Dead-letter/review with durable cause; no global head-of-line starvation; last good dashboard survives |
| W07 | Queue resumes next night | Same generation/checkpoint/token rules; no lost earlier invoices; prioritized historical work not starved |
| W08 | HTTP dispatch succeeds but runner missing/returns failed | Health shows dispatch≠business success; alert fires; cron active/succeeded not sufficient |
| W09 | Same import ID edited/older month corrected | Version-specific work is generated and processed, unlike current repair queue |
| W10 | Concurrent source correction during reconcile | Worker uses pinned manifest; old work cannot claim latest completion; next generation remains pending |
| E01 | Exact patient/date/doctor + qualifying matched clinical invoice | Unique eligible booking verifies once; evidence record points to source version/rule |
| E02 | Medicine-only bill, package sale, manual Completed/New/Old, shared phone, nearby admission | None alone verifies clinical attendance or therapy sessions |
| E03 | Duplicate bookings/doctor ambiguity/negative booking status conflict | Review case persists; no arbitrary first-booking assignment |
| E04 | Appointment after coverage or inside approved grace period | awaiting_MIS/pending; no false no-show |
| E05 | Covered date without qualifying invoice | no_invoice_confirmed_attendance/unknown evidence status; never infer no-show solely from absence |
| E06 | Prior verified invoice becomes void/moves patient or date | Retire invalid link and verification with audit, recompute conversion; preserve unrelated original manual facts |
| E07 | Multi-day IPD invoices | One admission episode; date-only data does not invent physical bed-nights beyond approved occupancy policy |
| A01 | Authenticated contact precedes first verified conversion | One patient origin; later eligible invoices inherit source and conserve chosen revenue measure |
| A02 | Later hotline/WhatsApp/Facebook touch | Engagement only; acquisition unchanged; no earlier invoice credit |
| A03 | Same-day date-only contact, late/missing/unauthenticated source | Explicit uncertainty/unattributed reason; no invented temporal order |
| A04 | Imported/backfilled CRM timestamp differs from original call log | Original trusted event date wins; preserve evidence and basis |
| A05 | Patient moves/earlier historical conversion arrives | Both patient histories recomputed, old attribution removed, original source/version audit retained |
| A06 | Several qualifying source contacts with tie | Approved evidence priority or unresolved; never arbitrary row-ID attribution |
| A07 | Refund/cancellation and prior-period billing | Signed attribution and positive billing remain separate; attributed+unattributed equals each same measure |
| D01 | Upstream incomplete at 07:40; shadow latest date unchanged after correction | Finalizers defer on generation mismatch; last good pointer unchanged |
| D02 | Financial mismatch but CRM reviews are otherwise valid | No publish on finance mismatch; genuine unresolved review cases can publish only as excluded/uncertain counts |
| D03 | Snapshot refresh already ran today before correction | New generation rebuilds affected historical ranges regardless of refreshed_at date |
| D04 | Crash halfway through candidate snapshots | No pointer switch; all users see previous complete generation |
| D05 | Dashboard loads multiple RPCs during pointer change | Pinned publication ID yields one consistent page; no old source/new attribution mix |
| D06 | Manual refresh/Vercel09:00 route/legacy function call | Same generation/window guard enforced; cannot bypass validated publication |
| D07 | New non-MIS invoice source exists | MIS validators scope owned evidence; no false failure or overwrite of other source financials |

## 5. Authorization and rollout tests

| ID | Scenario | Required behavior |
|---|---|---|
| S01 | Unauthenticated, inactive admin, agent, revoked capability | Deny upload/commit/download/retry; server uses fresh protected authorization |
| S02 | Authenticated user updates own role/is_active | SQL denied after M00; permitted self-service profile edit still works |
| S03 | Crafted metadata/actor/object path or another user's file ID | No elevation/BOLA; scope checked in API and database |
| S04 | Public/anon EXECUTE on privileged RPC | Denied; no default PUBLIC grant; private schema remains unexposed |
| S05 | Client sets `app.mis_worker` or sends service-like claims | No privilege change; role authorization independent of GUC/client metadata |
| S06 | CSRF/cross-origin cookie request, replayed expired URL | Denied; upload URL restricted to reserved path, no replace/delete |
| S07 | Raw names/HNs in application logs/errors/URLs | Redacted by default; authorized protected error artifact only |
| R01 | Disable intake/commit while upload in flight | Durable evidence survives; incomplete state explicit, no accidental commit |
| R02 | Disable worker after source committed | No partial publication, resumable queue; normal CRM remains available |
| R03 | Roll back publication pointer | Exact prior validated totals and patient evidence visible; newer source/history retained |
| R04 | Compensating correction after later valid generation | CAS/rebase, no overwriting later valid facts; both dependency closures recomputed |
| R05 | Code rollback with additive schema | Old UI remains operational; no rollback granting self-role elevation or dropping history |
| R06 | Restore drill to isolated project | Verified files/rows/version chain/financials/read models and auth; documented restore duration and approval |

## 6. Acceptance SQL and invariant outputs

Queries in A below use inspected existing objects and are read-only. Queries in B target **proposed** tables/columns and become runnable only after the named migrations. Implement the normalized read models with the stated columns or update these queries and tests in the same PR. SQL result of zero is necessary but not sufficient: positive controls must prove the test detects deliberately seeded corruption on the clone.

### A. Existing baseline checks (do not expect historical ownership equality)

```sql
select now() as audit_utc, current_setting('cron.timezone',true) as cron_timezone;

select im.id, im.source_file_name, im.source_row_count,
       count(m.id) as currently_owned_rows, im.status
from public.mis_report_imports im
left join public.mis_reports m on m.import_id=im.id
group by im.id order by im.id;
-- Baseline 1=20121/18289, 2=2674/0, 3=5513/4966, 4=3436/3436.
-- These differences expose provenance loss; do not fix declared counts to match.

select count(*) as rows,
       count(distinct lower(btrim(invoice_id_raw))) as invoice_keys,
       count(distinct hospital_number) as source_hns,
       max(invoice_date) as latest_invoice,
       sum(net_sales) as signed_source_4dp,
       sum(round(net_sales,2)) as signed_lines_2dp
from public.mis_reports;

select count(*) as duplicate_candidate_groups from (
  select lower(btrim(invoice_id_raw)),lower(btrim(item_id_raw))
  from public.mis_reports group by 1,2 having count(*)>1
) x;
-- Baseline 0; NOT evidence that this is universally a valid business key.

select count(*) filter(where reconciliation_status is distinct from 'matched')
       as unmatched, sum(net_bill) as positive_invoice_net
from public.invoices;
-- Baseline 0 /20600599.35. Never equate this measure to signed_source_4dp.

select status,count(*) from mis_internal.downstream_repair_queue group by status;

select jobid,status,count(*) as executions,max(start_time) as latest,
       max(extract(epoch from end_time-start_time)) as max_seconds
from cron.job_run_details
where jobid>=80 and start_time>now()-interval '7 days'
group by jobid,status order by jobid,status;

select has_column_privilege('authenticated','public.user_profiles','role','UPDATE')
       as can_update_role;
-- Baseline true. M00 gate requires false plus role-management regression tests.
```

### B. Proposed immutable/source/queue gates

```sql
-- M01/M03: sealed parses must match source-data-row accounting.
select p.id,p.expected_rows,count(r.row_no) actual
from mis_internal.mis_upload_parses p
left join mis_internal.mis_upload_rows r on r.parse_id=p.id
where p.sealed_at is not null
group by p.id,p.expected_rows
having count(r.row_no)<>p.expected_rows;
-- Expected 0; structured nondata rows are recorded separately by parser contract.

-- M03: no duplicate business identity; DB UNIQUE must also enforce this.
select namespace,facility_id,key_version,business_key,count(*)
from mis_internal.mis_canonical_line_keys
group by 1,2,3,4 having count(*)<>1;

-- M03: registry/current version points to the right key and source generation.
select k.id
from mis_internal.mis_canonical_line_keys k
left join mis_internal.mis_source_line_versions v on v.id=k.current_version_id
where v.id is null or v.key_id<>k.id or v.generation<>k.current_generation;

-- M04: every changed old/new invoice must have a queue event for its generation.
-- Implement this private view from immutable before/after version images,
-- named v_mis_changed_invoice_dependencies(namespace,invoice_key,generation).
select d.* from mis_internal.v_mis_changed_invoice_dependencies d
left join mis_internal.mis_changed_invoice_queue q
 on q.namespace=d.namespace and q.invoice_key=d.invoice_key
 and q.generation=d.generation
where q.invoice_key is null;

-- M05: completed work cannot claim the wrong source version.
select namespace,invoice_key,generation,completed_generation
from mis_internal.mis_changed_invoice_queue
where state='completed' and completed_generation is distinct from generation;

-- M05: zero out-of-hours downstream start OR finish, with no manual exemptions.
select * from mis_internal.mis_reconciliation_attempts
where ((started_at at time zone 'Asia/Dhaka')::time < time '00:15'
    or (started_at at time zone 'Asia/Dhaka')::time >= time '07:45')
   or (finished_at is not null and
      ((finished_at at time zone 'Asia/Dhaka')::time < time '00:15'
       or (finished_at at time zone 'Asia/Dhaka')::time >= time '07:45'));
```

File SHA and rowset SHA checks are independent re-download/reparse comparisons against stored values; do not “validate” a stored digest against itself. Mutability controls must be tested with actual non-owner roles on the clone. Source row accounting includes each input row exactly once; acceptance SQL for decisions groups by preview and asserts the mutually exclusive partition specified in the plan.

### C. Financial, identity and publication contract views

M05–M07 must implement private acceptance views with these explicit output contracts, which can also power health dashboards. Views must compare independently computed source-version and derived results; they cannot just expose a worker's self-reported success.

| Proposed view | Columns / formula | Gate |
|---|---|---|
| `v_mis_generation_invoice_check` | generation, invoice_key, source_count, actual_count, raw_net_4dp, source_line_net_2dp, actual_line_net_2dp, source_header_net_2dp, actual_signed_header_net_2dp, collection_delta, refund_bridge_delta, identity_error | Equal counts; exact per-measure equality; defined round deltas only; identity_error false |
| `v_mis_generation_attribution_check` | publication_id, measure, total, attributed, unattributed, duplicate_invoice_count, pre_source_credit_count, wrong_patient_count | attributed+unattributed=total; all error counts0 |
| `v_mis_verified_visit_check` | publication_id, appointment_id, has_identity_consistent_qualifying_evidence, booking_ambiguous, source_generation | Every verified claim has evidence; ambiguous false; correct generation |
| `v_mis_publication_gate_check` | publication_id, target_generation, source_manifest_matches, all_required_stages_complete, blocking_validation_count, snapshot_generation_count, review_count, coverage_status | manifest true; stages true; blocking0; exactly1 generation; open reviews explicit |

```sql
select * from mis_internal.v_mis_generation_invoice_check
where source_count<>actual_count
   or source_line_net_2dp is distinct from actual_line_net_2dp
   or source_header_net_2dp is distinct from actual_signed_header_net_2dp
   or collection_delta<>0 or refund_bridge_delta<>0 or identity_error;

select * from mis_internal.v_mis_generation_attribution_check
where attributed+unattributed is distinct from total
   or duplicate_invoice_count<>0 or pre_source_credit_count<>0
   or wrong_patient_count<>0;

select * from mis_internal.v_mis_verified_visit_check
where not has_identity_consistent_qualifying_evidence or booking_ambiguous;

select p.facility_id,g.*
from mis_internal.mis_publication_pointer p
join mis_internal.v_mis_publication_gate_check g
  on g.publication_id=p.published_run_id
where not g.source_manifest_matches or not g.all_required_stages_complete
   or g.blocking_validation_count<>0 or g.snapshot_generation_count<>1;
-- All four queries must return 0 rows for the candidate publication.
```

Compare every intermediate measure, not only overall sum: swapping money between patients can conserve the grand total. Include invoice, patient, department, month/year and acquisition-source rollups; unknown mapping is a separately conserved bucket, not dropped revenue. Signed net, positive billing, cancellations/refunds and collections have separate expected outputs.

## 7. Performance and operational gates

These are **proposed release targets**, not results measured in planning:

| Gate | Target / method |
|---|---|
| Parser | <=30 s and <=512 MiB RSS for admitted 20 MiB/50k-row inputs; reject expansion/size before exceeding limits; benchmark CSV and XLSX separately |
| Source commit | target<=15 s, hard<=30 s; lock wait<=1 s; no half-visible source merge; failure keeps original generation |
| Batch RPC | up to 25 complete invoices; p95<=2 s, enforced hard<=5 s; oversized IPD lane bounded and explicitly measured |
| Runner | max45 s work within verified 60 s host allowance; at most30 separately committed batches; no overlap; request logs prove actual completion |
| Nightly full replay | 26,691 rows/12,124 invoices plus dependencies within window with20% headroom; at least two representative runs; current idle cron durations are not benchmark evidence |
| Incremental SLA | Normal approved daily volume published by next 07:45; publish predicted completion/remaining capacity; never silently break window to meet SLA |
| Load isolation | Existing CRM page/API p95 no more than20% worse than measured pre-run baseline; no material increase in lock failures; tune batch/indices if violated |
| Recovery | Crash/retry converges to identical manifest; pointer rollback demonstrated within 5 minutes; whole restore duration measured, not assumed |
| Observability | Every dispatch matched to acknowledgement/outcome; no unexplained missed eligible tick; dead-letter alert by next 15-minute tick; source lag warning>2 days pending approved export calendar |

## 8. Release go/no-go

G0: reproducible schema baseline, profile-role protection, complete raw fixtures and confirmed authority/completeness contract. Without stable line identity/authority, only receipt/preview can ship.

G1: parser/security matrix passes; original files round-trip hash/count; no patient data committed to repository; intake flag off in production.

G2: all C tests pass on clone, including order reversal, concurrent commits, old-patient invalidation, signed money and original history preservation. No fallback last-upload-wins.

G3: worker/clinical/attribution tests and actual timeout tests pass; full-load capacity has headroom; out-of-hours mutations zero; no unresolved critical auth/financial error.

G4: publication barrier, all existing manual/scheduled reader paths and rollback drill pass; last good snapshot remains consistent on every injected failure.

G5: explicit approval for production canary/schedules; validated backups and named rollback owner; actual cron dispatch and business result observed. Small canary passes before historical correction canary, then two successful nights before broader enablement.

Any nonzero critical invariant, privilege bypass, unsupported correction authority, corrupted source hash, mixed generation, false verified visit, double attribution or unbounded runtime is **NO-GO**. Genuine unresolved clinical/source reviews remain visible and excluded from verified claims; they are not fabricated into success or forced to zero.

# Administrator attribution review

Open **Attribution Review** in the administrator navigation, or follow the review link from MIS Uploads. Only active administrators can load cases or save decisions. Browser requests go through authenticated server routes; private evidence, history and correction tables are not exposed to browser database roles.

## Meta identity cases

The default queue contains open identity reviews. Filter by investigation reason, search by phone or case ID, and use the reviewed filter to reopen a previous decision. Review original messages, the native inbound-direction indicator, campaign touches and CRM matches. Messages and invoices load in bounded pages.

To confirm an identity or resolve duplicate CRM leads, select an existing lead linked to a canonical hospital patient. Independently verify the hospital number, record supporting evidence and explain any shared phone or caregiver relationship. The administrator must explicitly attest to this verification. A phone match or an automatically suggested match is insufficient.

Confirmation sets the selected reconciliation lead and candidate status, links the Messenger contact and the candidate's source events, and preserves every source record. A conversation cannot be assigned to a competing confirmed lead. Duplicate resolution does not merge or delete CRM records. If no verified CRM lead exists, keep the case open or record a reviewed no-match decision; use the existing lead intake workflow to create a genuine intake when appropriate.

Reopening or rejecting a prior confirmation removes its Messenger links only if no other confirmed review still owns them. This retracts the corresponding acquisition evidence on reconciliation. The audit records the prior and resulting links. Confirmation and reversal never send messages or initiate external marketing exports.

## Unattributed revenue

The queue groups unattributed invoices by canonical patient and attribution reason. It shows net bill, not cash collected or total patient lifetime revenue. Amounts come from the last integrity-checked lifetime publication, and stay stable while the worker clears and rebuilds its intermediate tables. A new validated publication refreshes the queue atomically.

Pooled billing identities such as General Customer remain visible but cannot receive a single acquisition source or Meta identity confirmation. Establish individual hospital identities through genuine intake or a corrected MIS import first; the review page does not distribute pooled invoices by assumption.

To correct acquisition evidence, verify the hospital identity, original source and original event date against a referenced record. The original event date is distinct from the review timestamp. Supported categories are Facebook/Meta, Google, referral, doctor recommendation and organic/direct. The correction does not infer an ad or campaign from a source label.

If an existing source record is demonstrably wrong, explicitly select it under “Replace incorrect source evidence” and explain the correction. The original record remains unchanged. Attribution use of the selected patient/evidence pair and its derived CRM/lead-attribution copies is suppressed while the correction is active, including copies created by later reconciliation. Each patient has one current correction; later versions preserve the entire history. Retracting a correction restores the original evidence rules.

The existing acquisition rules still apply: late evidence cannot acquire earlier clinical revenue, invoices preceding the acquisition remain excluded, and clinical conversion must be supported by invoice lines. A new verified record does not guarantee that the whole displayed amount becomes attributable. Earlier valid evidence can still win; current evidence is shown for review after saving.

## Save and reconciliation guarantees

1. The route validates the user's live Supabase identity and active administrator profile. The database independently checks the service role and administrator.
2. Each request includes a case version and a unique request ID. Changed cases or changed selected CRM leads reject stale edits. Retrying an identical request returns the original receipt without another correction; reusing its ID with a different payload is rejected.
3. The correction, immutable before/after audit and durable source-revision increment commit in one database transaction. Failed validation rolls the transaction back.
4. The server starts the existing worker after the response. The durable revision survives a failed or interrupted request; the existing cron retries it.
5. The worker follows the existing overnight guard, 00:15–07:45 Asia/Dhaka. Outside that window, the UI reports queued. It rebuilds marketing attribution, lifetime acquisitions/invoice attribution, appointment verification, contact history, ad outcomes and dashboard snapshots through the existing publication stages. Source-only corrections do not replay CSV invoice jobs.
6. A receipt is shown as reconciled only after the complete publication has reached at least its requested revision, is current with the source revision, and has no pending or failed invoice jobs. An unrelated new source edit may conservatively show receipts as awaiting reconciliation again until the current publication completes.

No cron schedule, source invoice, immutable upload history or financial amount is changed by this feature. `MIS_INGESTION_ENABLED=false` pauses correction writes while retaining read access. A failed import must be resolved through MIS Uploads before publication can complete.

## Delivery and verification

Apply the additive `admin_attribution_review`, `admin_review_source_record_details` and `admin_review_pooled_identity_guard` migrations before deploying the Next.js release. They create private history/correction/snapshot tables, service-only RPC entry points, bounded original-source detail panels, a pooled-account safeguard and a publication-completion snapshot trigger. The initial seed reads existing validated attribution and does not make identity or revenue decisions.

Run `npm run test:marketing-review`, parser/marketing/gateway suites, TypeScript, lint for changed files, the production build and `scripts/mis-upload/smoke-http.mjs`. The review suite uses synthetic data and runs in CI without private schema exports. The locally available gateway contract additionally tests a review correction through the actual finance/marketing/lifetime/contact/ad/snapshot functions and verifies unchanged MIS row counts and revenue conservation.

After deployment, verify the authenticated queues, filters, case detail, evidence, search and audit layout. Confirm unauthenticated API denial and service-only RPC grants. Do not submit invented corrections as a production smoke test. Keep real case exports and live database metadata local.

## Rollback

For an individual decision, reopen the Meta review or retract the source correction through this page with an explanatory note, then allow the same reconciliation pipeline to publish the reversal. Original messages, contacts, invoice data and source evidence remain available.

For an application regression, roll back the Vercel deployment and revoke execution on both public review RPCs from `service_role` to pause only these new endpoints. The pre-existing ingestion worker continues using the additive evidence view and saved corrections. Do not remove the correction tables or restore an old evidence view while active corrections exist; that would silently change attribution. A database rollback requires audited reversals followed by a validated publication, then a separate reviewed migration. Retain immutable audit history throughout.

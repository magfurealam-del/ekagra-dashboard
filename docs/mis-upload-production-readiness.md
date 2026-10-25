# MIS and marketing ingestion: release and acceptance

The production entry point is `/admin/mis-upload` in Vercel project `project-sbcum`. The operational contract is [mis-upload-gateway-rollout.md](mis-upload-gateway-rollout.md). This document replaces the earlier intake-only readiness proposal; canonical ingestion and downstream publication are implemented.

## Release sequence

1. Run `test:mis-parser`, `test:mis-gateway`, `test:mis-marketing`, `check:marketing-edge`, TypeScript, ESLint on changed application files, and the optimized Next.js build. The full gateway contract uses an ignored local schema fixture. The standalone marketing suite uses a synthetic schema and runs in CI without private metadata.
2. Review the exact migration delta against the live ledger. Apply the attribution/reconciliation migration before the spend-sync migration. Keep the existing cron schedules and processing window. Never run a broad migration-history repair.
3. Deploy `supabase/functions/marketing-spend-sync` with `verify_jwt=true` and its `deno.json`. It uses the existing server-side `META_ADS_TOKEN` and optional `META_AD_ACCOUNT_IDS` / `META_AD_ACCOUNT_ID`. Otherwise it discovers enabled ad accounts from the existing catalog. Do not copy credentials into source or browser code.
4. Deploy the tested application to the linked production Vercel project. Source uploads exclude `.env*`, database metadata, migrations, scripts, and documentation through `.vercelignore`.
5. During the existing Dhaka processing window, use **Refresh sources and reconciliation** on an accepted upload. Observe durable progress, source revision, spend freshness, and publication status. A successful request alone does not prove completion.
6. Verify canonical invoice/line counts and signed finance totals; zero missing invoice jobs; completed marketing/lifetime stages; matching source and publication revisions; lifetime integrity checks; and no revenue assigned to evidence arriving after acquisition. Check that campaign reports do not multiply revenue through appointment or phone joins.
7. Verify Meta account backfill coverage through yesterday in the account timezone, immutable observations, and no duplicate ad/day natural keys. A completed MIS publication does not imply the external spend backfill has finished; its separate status must also be checked.
8. Check denied unauthenticated admin/cron requests and compare security advisors. Commit migrations and application code together, merge the reviewed release into `main`, and retain the previous application deployment for rollback.

## What completion means

Every billed patient has an attribution disposition, including explicit missing, late, unverified, or conflicting evidence. Completion does not mean every patient has a known acquisition source. Confirmed Messenger identities and independently supported ad links qualify; shared phone numbers and unreviewed suggestions do not. Administrative backfill timestamps are not original acquisition dates. Date-only same-day evidence is flagged as having uncertain event ordering.

The source revision covers CRM leads, calls, lead attribution, referrals, reviewed Messenger/Meta links, patient identity, appointments, and stored spend. Changes invalidate publication and resume a bounded downstream rebuild without replaying canonical invoices. Failed spend synchronization remains visible and does not stop finance reconciliation.

Spend uses native currency. USD and BDT remain separate; no conversion rate or missing campaign cost is invented. The initial external backfill resumes after the existing spend cache's last stored date, then refreshes the previous seven completed days once daily. Legacy history before that boundary is preserved and requires a separately scoped audit if incomplete. Configured accounts must belong to this business; expanding to additional accounts requires checking the legacy baseline and account-specific coverage.

## Rollback and recovery

Keep immutable CSV receipts, rows, page observations, source versions, and reconciliation history. Retry interrupted work through its stored lease/cursor; do not reset completed invoice jobs merely to refresh marketing. Correct source evidence and request reconciliation to retract stale attribution.

For an application regression, promote the retained previous Vercel deployment. The database additions preserve prior intake endpoints and RPC signatures; do not drop the new tables or regrant public mutation access. For a faulty derived-data rule, stop worker execution with the existing ingestion feature flag, preserve source history, and deliver a forward migration plus a new reconciliation revision. Never restore derived attribution by rewriting source invoices. External spend failures can be corrected independently; MIS remains operable.

After rollback, verify the publication watermark and derived-table integrity again. This release does not provide a fully isolated historical dashboard generation: some underlying derived tables update during reconciliation. Administrators must use the publication status when deciding whether reports are current.

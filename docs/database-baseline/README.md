# Read-only Supabase baseline — 2026-10-23

Captured through Supabase SQL inspection for project youqgrwovfyqqsnbtcnm. No production data or scheduled jobs were changed.

## Artifacts

- 2026-10-23-live-mis-schema.json records live columns for mis_internal and selected public tables, constraints, indexes, trigger definitions, function body fingerprints and privileges, relevant policies, cron schedules and command fingerprints, and aggregate MIS source counts.
- applied-migrations-2026-10-23.json records all 602 migration ledger version/name pairs returned by the live project.

The files contain no patient rows, source file contents, API keys, passwords, or decrypted Vault values. Function bodies and cron commands are fingerprinted so local source can be checked against the live surface without storing executable production code in this baseline.

## Recovered facts and remaining gap

The current implementation branch has three active migration files for authorization hardening and MIS upload intake. Thirteen tracked legacy migration files from the dashboard's older history are preserved in `supabase/archived-migrations/2026-10-23/`; their versions do not match the captured production ledger, so leaving them in `supabase/migrations/` would make a normal `db push` try to replay them. The archive manifest records SHA-256 values and candidate ledger entries. A candidate name or a present-day catalog object is not proof that an archived SQL body is the exact migration that produced production's current object.

The live ledger has 602 entries, of which 601 have no exact-version local source file. All 39 entries dated October 21–22 are in that gap. The legacy source archive preserves 13 earlier files, but it does not restore the exact historical source history. Names and versions are preserved in the applied-ledger artifact; migration source text is not stored in `supabase_migrations.schema_migrations`.

## Read-only source recovery audit

The following sources were checked on October 23, 2026:

- Local Git history and unreachable Git objects contain only the earlier July–September migration trees; no October 21–22 SQL was recoverable.
- GitHub `main` ends at commit `8886261316a4ffef3993fe1e6090d081aa6ecf0a` from September 8, 2026. The repository's pull requests 1–23 contain no SQL migration file diffs. The repository has no `.github/workflows` path, and no workflow run was associated with the September 8 `main` commit.
- The connected GitHub branch search found only `main` and this implementation branch; no source branch holds the October SQL. Supabase reports no development branches for this project.
- The available `ekagra-dashboard*.zip` archives in Downloads contain no migration entries.
- The Supabase migration ledger returns only version/name pairs. It does not include the SQL bodies.

This establishes that exact migration-source recovery for the missing versions cannot proceed from the connected checkout, its GitHub history, or the Supabase ledger. Remaining authoritative sources would be an owner-held source branch/export, CI artifact or database backup containing the migration files. If none exists, use a separately reviewed schema-first baseline bootstrap; do not invent historical SQL or mark old versions applied based on names alone.

Read-only SQL catalog checks confirmed key objects from the archived Messenger, dashboard-metrics, website-booking, and call-queue migration areas are present. These checks were metadata-only and do not establish full migration-body equivalence. The Supabase CLI is installed, but no `SUPABASE_ACCESS_TOKEN` is available to it; Docker also denied access to its Linux engine in this session, so `db dump --linked` could not export DDL. Do not use the archived source files to rebuild a clean database. Recover the exact missing files or produce and review a schema-first baseline before claiming that clean reset/rebuild is supported.

At capture, the database reported PostgreSQL 17, cron.timezone = GMT, 26,691 MIS rows, 12,124 invoice keys, and latest MIS invoice date 2026-10-20. These are dated reference values, not assertions for later runs.

## Safe comparison

`applied-migrations-2026-10-23-predeploy.json` preserves the 602-entry predeployment ledger. `applied-migrations-2026-10-23.json` is the verified 605-entry production ledger after the MIS upload release. `npm run audit:mis-baseline` compares the active migration directory with that current ledger; archived historical sources remain outside the CLI path. `npm run check:mis-upload-deploy-scope` checks the active migration allowlist and hashes. A `current` status means the allowlisted files match the live applied ledger; if future migrations are pending, run `supabase db push --linked --dry-run` and verify the exact target and migration set before applying them.

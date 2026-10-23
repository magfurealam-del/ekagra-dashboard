# Read-only Supabase baseline — 2026-10-23

Captured through Supabase SQL inspection for project youqgrwovfyqqsnbtcnm. No production data or scheduled jobs were changed.

## Artifacts

- 2026-10-23-live-mis-schema.json records live columns for mis_internal and selected public tables, constraints, indexes, trigger definitions, function body fingerprints and privileges, relevant policies, cron schedules and command fingerprints, and aggregate MIS source counts.
- applied-migrations-2026-10-23.json records all 602 migration ledger version/name pairs returned by the live project.

The files contain no patient rows, source file contents, API keys, passwords, or decrypted Vault values. Function bodies and cron commands are fingerprinted so local source can be checked against the live surface without storing executable production code in this baseline.

## Recovered facts and remaining gap

The inspected checkout started at 8886261316a4ffef3993fe1e6090d081aa6ecf0a, with 15 local migration files. The live ledger has 602 entries: 601 have no matching local versioned file, and one of the local files matches a live version. Fourteen local files have no matching applied ledger version. The especially relevant 38 MIS/CRM entries dated October 21–22 are included in the gap. The local and live migration histories therefore cannot be applied in order safely. Their names and versions are preserved in the applied-ledger artifact; migration source text is not stored in supabase_migrations.schema_migrations.

The connected read-only SQL tool provides the current schema surface and function definitions for inspection, but the local Supabase CLI has no access token in this checkout. Its db dump --linked command therefore cannot export DDL. This PR records a reproducible schema fingerprint baseline and the exact migration gap. It does not claim that the missing historical SQL files have been recovered. Obtain those files from their source branch/CI artifacts or approve a schema-first baseline bootstrap before applying migrations or building a clean clone from scratch. Do not mark missing migrations applied by name alone.

At capture, the database reported PostgreSQL 17, cron.timezone = GMT, 26,691 MIS rows, 12,124 invoice keys, and latest MIS invoice date 2026-10-20. These are dated reference values, not assertions for later runs.

## Safe comparison

Run node scripts/mis-upload/compare-baseline.mjs to compare local migration filenames with the captured applied ledger. It reports missing source files and pending local migrations without connecting to Supabase or changing the live ledger. Review pending filenames before any schema synchronization command.

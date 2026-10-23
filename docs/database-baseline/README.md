# Read-only Supabase baseline — 2026-10-23

Captured through Supabase SQL inspection for project youqgrwovfyqqsnbtcnm. No production data or scheduled jobs were changed.

## Artifacts

- 2026-10-23-live-mis-schema.json records live columns for mis_internal and selected public tables, constraints, indexes, trigger definitions, function body fingerprints and privileges, relevant policies, cron schedules and command fingerprints, and aggregate MIS source counts.
- applied-migrations-2026-10-23.json records all 602 migration ledger version/name pairs returned by the live project.

The files contain no patient rows, source file contents, API keys, passwords, or decrypted Vault values. Function bodies and cron commands are fingerprinted so local source can be checked against the live surface without storing executable production code in this baseline.

## Recovered facts and remaining gap

The clean implementation branch starts at `8886261316a4ffef3993fe1e6090d081aa6ecf0a` and contains 15 versioned-looking migration files after adding this PR's two new migrations. One matches the live ledger; 14 are pending. The original shared checkout also contained 16 pre-existing untracked migration files. Including those and the two new PR files, 31 migration files were present in that working tree: one exact version/name match and 30 pending versions. Those untracked files remain in the shared checkout and are not copied into this PR. They are not counted as recovered applied migrations because their versions do not match the live ledger.

The live ledger has 602 entries, of which 601 have no matching local versioned file. All 39 entries dated October 21–22 are in that gap. The local and live migration histories therefore cannot be applied in order safely. Their names and versions are preserved in the applied-ledger artifact; migration source text is not stored in `supabase_migrations.schema_migrations`.

## Read-only source recovery audit

The following sources were checked on October 23, 2026:

- Local Git history and unreachable Git objects contain only the earlier July–September migration trees; no October 21–22 SQL was recoverable.
- GitHub `main` ends at commit `8886261316a4ffef3993fe1e6090d081aa6ecf0a` from September 8, 2026. The repository's pull requests 1–23 contain no SQL migration file diffs. The repository has no `.github/workflows` path, and no workflow run was associated with the September 8 `main` commit.
- The connected GitHub branch search found no source branch holding the October SQL, and Supabase reports no development branches for this project.
- The Supabase migration ledger returns only version/name pairs. It does not include the SQL bodies.

This establishes that migration-source recovery cannot proceed from the connected checkout, its GitHub history, or the Supabase ledger. Remaining authoritative sources would be an owner-held source branch/export, CI artifact or database backup containing the migration files. If none exists, use a separately reviewed schema-first baseline bootstrap; do not invent historical SQL or mark old versions applied based on names alone.

The connected read-only SQL tool provides the current schema surface and function definitions for inspection, but the local Supabase CLI has no access token in this checkout. Its db dump --linked command therefore cannot export DDL. This PR records a reproducible schema fingerprint baseline and the exact migration gap. It does not claim that the missing historical SQL files have been recovered. Obtain those files from their source branch/CI artifacts or approve a schema-first baseline bootstrap before applying migrations or building a clean clone from scratch. Do not mark missing migrations applied by name alone.

At capture, the database reported PostgreSQL 17, cron.timezone = GMT, 26,691 MIS rows, 12,124 invoice keys, and latest MIS invoice date 2026-10-20. These are dated reference values, not assertions for later runs.

## Safe comparison

Run node scripts/mis-upload/compare-baseline.mjs to compare local migration filenames with the captured applied ledger. It reports missing source files and pending local migrations without connecting to Supabase or changing the live ledger. Review pending filenames before any schema synchronization command.

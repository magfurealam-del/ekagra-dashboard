# MIS upload migration deployment scope

The captured production project `youqgrwovfyqqsnbtcnm` has 602 migration-ledger entries through `20261022235907`. The repository's 13 older migration files use versions that are not in that ledger. Replaying them by those local versions could overwrite current functions or recreate objects. Their SQL is retained under `supabase/archived-migrations/2026-10-23/` with hashes, outside the Supabase CLI's active migration directory.

The active directory contains only these additive MIS upload migrations:

| Version | Purpose |
|---|---|
| `20261023023029` | Protect user profile authorization fields |
| `20261023023032` | Create immutable MIS upload intake and staging tables |
| `20261023101823` | Add reservation, ingestion, staging and admin read RPCs |

The project now has a minimal `supabase/config.toml` with Postgres 17 and local seeding disabled. The local scope checker verifies active filenames, SHA-256 hashes, target project identity, captured ledger hash, and archived-file hashes:

```powershell
npm run check:mis-upload-deploy-scope
```

Before deployment, authenticate the Supabase CLI in an authorized environment, link this checkout to the exact project, and run a live read-only dry run:

```powershell
$env:SUPABASE_TELEMETRY_DISABLED = '1'
supabase link --project-ref youqgrwovfyqqsnbtcnm
supabase db push --linked --dry-run
```

The live dry run must name only the three allowlisted versions. If remote history has changed, the database link resolves to another project, or any unexpected migration appears, stop and re-audit. Do not use `--include-all`, migration repair, or remote reset to bypass the mismatch. A successful dry run only prepares the deployment; apply the migrations only after explicit deployment approval and an agreed rollback window.

The local scope check does not resolve the separate clean-rebuild gap: 601 remote ledger versions have no exact-version SQL source in the checkout. A clean Supabase reset remains unsupported until those sources are recovered or a full schema-first baseline is reviewed and adopted. No production data, schema, migration ledger, Storage bucket, feature flag, or cron schedule was modified while preparing this scope.

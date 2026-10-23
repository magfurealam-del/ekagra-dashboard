# MIS upload migration deployment scope

The production project `youqgrwovfyqqsnbtcnm` now has 605 migration-ledger entries through `20261023130735`. The 602-entry predeployment ledger is preserved at `docs/database-baseline/applied-migrations-2026-10-23-predeploy.json`. The repository's 13 older migration files use versions that are not in that ledger. Replaying them by those local versions could overwrite current functions or recreate objects. Their SQL is retained under `supabase/archived-migrations/2026-10-23/` with hashes, outside the Supabase CLI's active migration directory.

The active directory contains only these additive MIS upload migrations:

| Version | Purpose |
|---|---|
| `20261023130722` | Protect user profile authorization fields |
| `20261023130728` | Create immutable MIS upload intake and staging tables |
| `20261023130735` | Add reservation, ingestion, staging and admin read RPCs |

All three were applied to production and verified in the migration ledger. The private `mis-upload-source` bucket and seven staging tables exist; upload RPCs are not executable by `anon` or `authenticated` directly. `MIS_UPLOADS_ENABLED` is enabled for the Vercel production environment only. Cron schedules and canonical MIS invoice data were not changed.

The project now has a minimal `supabase/config.toml` with Postgres 17 and local seeding disabled. The local scope checker verifies active filenames, SHA-256 hashes, target project identity, captured ledger hash, and archived-file hashes:

```powershell
npm run check:mis-upload-deploy-scope
```

For future changes, authenticate the Supabase CLI in an authorized environment, link this checkout to the exact project, and run a live read-only dry run:

```powershell
$env:SUPABASE_TELEMETRY_DISABLED = '1'
supabase link --project-ref youqgrwovfyqqsnbtcnm
supabase db push --linked --dry-run
```

The scope checker must show no pending MIS migrations before routine work resumes. If future migrations are pending, the live dry run must name only the intended allowlisted versions. If remote history has changed, the database link resolves to another project, or any unexpected migration appears, stop and re-audit. Do not use `--include-all`, migration repair, or remote reset to bypass a mismatch.

The release did not resolve the separate clean-rebuild gap: 602 historical remote ledger versions have no exact-version SQL source in the active checkout. A clean Supabase reset remains unsupported until those sources are recovered or a full schema-first baseline is reviewed and adopted. The production changes were additive staging infrastructure and a profile authorization hardening; no canonical MIS invoice rows or cron schedules were changed.

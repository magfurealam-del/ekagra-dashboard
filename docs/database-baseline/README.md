# Local database release evidence

Live schema snapshots, migration ledgers, project references, fingerprints, and the corresponding source allowlist belong in the ignored local directory private. Do not commit them. The public repository contains migration sources and tests, not a copy of the live catalog or applied-history export.

Run npm run check:mis-upload-deploy-scope to check migration source filenames and, when supabase/migration-scope.local.json exists, source hashes against the local allowlist. Before a schema change, inspect the intended project and current ledger through authenticated read-only access.

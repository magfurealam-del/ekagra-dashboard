# MIS upload migration safety

Captured database catalogs, project references, applied migration ledgers, and fingerprints are held in ignored local files. They are not part of this public repository.

Before applying a future migration, verify the selected Supabase project in its connected console, inspect the live migration ledger, review SQL against the current schema, and run a read-only dry run. Apply only reviewed migrations. Do not repair migration history or replay archived migrations to bypass a mismatch.

A clean database rebuild is unsupported while the repository lacks the complete historical migration source. Keep a current backup and verify restore access before future schema changes.

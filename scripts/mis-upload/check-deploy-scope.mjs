import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex')
const scope = await readJson(join(root, 'supabase/migration-scope.json'))
const baseline = await readJson(join(root, 'docs/database-baseline/applied-migrations-2026-10-23.json'))
const archived = await readJson(join(root, 'supabase/archived-migrations/2026-10-23/manifest.json'))
const activeDir = join(root, 'supabase/migrations')
const archiveDir = join(root, 'supabase/archived-migrations/2026-10-23')
const activeNames = (await readdir(activeDir)).filter((name) => /^\d{14}_.+\.sql$/.test(name)).sort()
const expectedNames = scope.active_migrations.map(({ file }) => file).sort()
const errors = []

if (baseline.project_id !== scope.target_project_ref) errors.push('The migration scope and captured baseline target different Supabase projects.')
if (baseline.migrations.at(-1)?.version !== scope.baseline_latest_version) errors.push('The captured baseline latest migration does not match the migration scope.')
if (hash(await readFile(join(root, 'docs/database-baseline/applied-migrations-2026-10-23.json')) ) !== scope.baseline_ledger_sha256) {
  errors.push('The captured applied-migration ledger has changed since the scope was reviewed.')
}
if (JSON.stringify(activeNames) !== JSON.stringify(expectedNames)) errors.push('Active migration files differ from the explicit deployment allowlist.')

const appliedNamesByVersion = new Map(baseline.migrations.map(({ version, name }) => [version, name]))
const pending = []
const applied = []
for (const migration of scope.active_migrations) {
  const bytes = await readFile(join(activeDir, migration.file)).catch(() => null)
  if (!bytes) {
    errors.push(`Allowlisted migration is missing: ${migration.file}`)
    continue
  }
  if (hash(bytes) !== migration.sha256) errors.push(`Allowlisted migration content changed: ${migration.file}`)
  const appliedName = appliedNamesByVersion.get(migration.version)
  if (appliedName !== undefined) {
    if (appliedName !== migration.name) {
      errors.push(`Allowlisted migration version is recorded with a different name: ${migration.version}`)
    } else {
      applied.push({ version: migration.version, name: migration.name, sha256: migration.sha256 })
    }
  } else {
    pending.push({ version: migration.version, name: migration.name, sha256: migration.sha256 })
  }
}

const archivedNames = (await readdir(archiveDir)).filter((name) => /^\d{14}_.+\.sql$/.test(name)).sort()
const expectedArchived = archived.files.map(({ file }) => file).sort()
if (JSON.stringify(archivedNames) !== JSON.stringify(expectedArchived)) errors.push('Archived migration files differ from the archive manifest.')
for (const entry of archived.files) {
  const bytes = await readFile(join(archiveDir, entry.file)).catch(() => null)
  if (!bytes) errors.push(`Archived migration is missing: ${entry.file}`)
  else if (hash(bytes) !== entry.sha256) errors.push(`Archived migration content changed: ${entry.file}`)
}
const localVersions = new Set([...activeNames, ...archivedNames].map((name) => name.slice(0, 14)))
const exactVersionSourceGaps = baseline.migrations.filter(({ version }) => !localVersions.has(version)).length

console.log(JSON.stringify({
  status: errors.length ? 'blocked' : pending.length === 0 ? 'current' : 'ready_for_live_dry_run',
  target_project_ref: scope.target_project_ref,
  baseline_latest_version: scope.baseline_latest_version,
  active_migration_count: activeNames.length,
  applied_against_current_ledger: applied,
  pending_against_captured_ledger: pending,
  archived_legacy_migration_count: archivedNames.length,
  remote_ledger_entries_without_exact_versioned_source: exactVersionSourceGaps,
  requires_live_db_push_dry_run: pending.length > 0,
  production_deployment_approved_by_this_check: false,
  errors,
}, null, 2))

if (errors.length) process.exitCode = 1

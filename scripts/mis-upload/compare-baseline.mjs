import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const scope = await readFile(join(root, 'supabase/migration-scope.local.json'), 'utf8').then(JSON.parse).catch(() => null)
if (!scope) { console.log('Skipped: captured migration history is kept in ignored local evidence.'); process.exit(0) }
const baselinePath = join(root, 'docs/database-baseline/private', scope.baseline_ledger_file)
const migrationsPath = join(root, 'supabase/migrations')

const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
const localFiles = (await readdir(migrationsPath)).filter((name) => /^\d{14}_.+\.sql$/.test(name))
const localByVersion = new Map(localFiles.map((name) => [name.slice(0, 14), name.slice(15, -4)]))
const appliedByVersion = new Map(baseline.migrations.map(({ version, name }) => [version, name]))

const appliedWithoutLocalSource = [...appliedByVersion]
  .filter(([version]) => !localByVersion.has(version))
  .map(([version, name]) => ({ version, name }))
const localNotInAppliedLedger = [...localByVersion]
  .filter(([version]) => !appliedByVersion.has(version))
  .map(([version, name]) => ({ version, name }))
const nameMismatches = [...localByVersion]
  .filter(([version, name]) => appliedByVersion.has(version) && appliedByVersion.get(version) !== name)
  .map(([version, local_name]) => ({ version, local_name, applied_name: appliedByVersion.get(version) }))

console.log(JSON.stringify({
  baseline_project: baseline.project_id,
  baseline_captured_at_utc: baseline.captured_at_utc,
  local_migration_files: localFiles.length,
  applied_migrations: baseline.migrations.length,
  applied_without_local_source: appliedWithoutLocalSource,
  local_not_in_applied_ledger: localNotInAppliedLedger,
  name_mismatches: nameMismatches,
}, null, 2))

if (appliedWithoutLocalSource.length || nameMismatches.length) process.exitCode = 1

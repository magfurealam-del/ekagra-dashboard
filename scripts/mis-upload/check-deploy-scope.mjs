import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const scopePath=join(root,'supabase/migration-scope.local.json')
const files=(await readdir(join(root,'supabase/migrations'))).filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort()
const scope=await readFile(scopePath,'utf8').then(JSON.parse).catch(()=>null)
if(!scope){console.log(JSON.stringify({status:'source_files_present',migration_count:files.length,live_database_fingerprint:'local_only'}));process.exit(0)}
const errors=[]
const expected=scope.active_migrations.map(x=>x.file).sort()
if(JSON.stringify(files)!==JSON.stringify(expected)) errors.push('Migration source files differ from the local deployment allowlist.')
for(const m of scope.active_migrations){const b=await readFile(join(root,'supabase/migrations',m.file)).catch(()=>null);if(!b)errors.push('Missing local migration source: '+m.file);else if(createHash('sha256').update(b.toString('utf8').replace(/\r\n/g,'\n')).digest('hex')!==m.sha256)errors.push('Local migration source hash differs: '+m.file)}
console.log(JSON.stringify({status:errors.length?'blocked':'source_files_verified',migration_count:files.length,live_database_fingerprint:'local_only',errors},null,2))
if(errors.length)process.exitCode=1

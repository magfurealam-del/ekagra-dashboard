import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'

// Exercise the built HTTP routes without production credentials or database access.
const socket=createServer()
socket.listen(0,'127.0.0.1')
await once(socket,'listening')
const port=socket.address().port
await new Promise(resolve=>socket.close(resolve))
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'--hostname','127.0.0.1'],{
 env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'placeholder',
  SUPABASE_SERVICE_ROLE_KEY:'placeholder',MIS_UPLOADS_ENABLED:'true',MIS_INGESTION_ENABLED:'true',CRON_SECRET:'synthetic-smoke-secret'},
 stdio:['ignore','ignore','pipe'],windowsHide:true,
})
let stderr=''
child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-2000)})
const url=`http://127.0.0.1:${port}`
try {
 let ready=false
 for(let n=0;n<100;n++) {
  if(child.exitCode!==null) throw new Error(`Test server exited: ${stderr}`)
  try {await fetch(`${url}/api/cron/mis-ingestion`);ready=true;break} catch {await sleep(100)}
 }
 assert.ok(ready,'Test server did not start')
 const id='00000000-0000-4000-8000-000000000001'
 const checks=[
  ['GET','/api/admin/mis-uploads'],['POST','/api/admin/mis-uploads'],
  ['GET','/api/admin/marketing-reviews'],['POST','/api/admin/marketing-reviews'],
  ['POST',`/api/admin/mis-uploads/${id}/finalize`],
  ['GET',`/api/admin/mis-uploads/${id}/pipeline`],['POST',`/api/admin/mis-uploads/${id}/pipeline`],
  ['GET','/api/cron/mis-ingestion'],['GET','/api/cron/sync-invoice-corrections'],
 ]
 for(const [method,path] of checks) {
  const response=await fetch(url+path,{method})
  assert.equal(response.status,401,`${method} ${path} must deny unauthenticated requests`)
  assert.ok((await response.json()).error)
 }
 assert.equal((await fetch(url+'/api/cron/mis-ingestion',{headers:{Authorization:'Bearer incorrect'}})).status,401)
 console.log(`PASS: ${checks.length + 1} built HTTP authorization checks; no database requests or production secrets.`)
} finally {
 child.kill()
 await once(child,'exit').catch(()=>{})
}

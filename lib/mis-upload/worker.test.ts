import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drainMisQueue } from './worker.ts'

test('drains separate transactions until idle', async () => {
 const statuses = ['completed','superseded','advanced','idle']
 const result = await drainMisQueue(async () => ({ status: statuses.shift()! }))
 assert.equal(result.ticks,4)
 assert.equal(result.last.status,'idle')
})
test('stops on retries, deferrals, closed window, busy and pending work', async () => {
 for (const status of ['retry','deferred','outside_overnight_window','busy','awaiting_jobs']) {
  const result = await drainMisQueue(async () => ({ status }))
  assert.equal(result.ticks,1)
 }
})
test('reserves the maximum RPC duration before starting another transaction', async () => {
 let now=0
 const result = await drainMisQueue(async () => { now+=60_000; return {status:'completed'} },{now:()=>now,budgetMs:240_000})
 assert.equal(result.ticks,2)
 assert.equal(result.elapsedMs,120_000)
})
test('RPC errors are not reported as successful drains', async () => {
 await assert.rejects(drainMisQueue(async () => {throw new Error('network failed')}))
})

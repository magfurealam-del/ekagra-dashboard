import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drainMisQueue, isOvernightInDhaka } from './worker.ts'

test('daytime recovery does not sync spend outside the clinic overnight window', () => {
 for (const [utc, expected] of [['2026-10-25T18:14:00Z',false],['2026-10-25T18:15:00Z',true],['2026-10-26T01:44:00Z',true],['2026-10-26T01:45:00Z',false],['2026-10-26T11:00:00Z',false]] as const)
  assert.equal(isOvernightInDhaka(new Date(utc)), expected)
})

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

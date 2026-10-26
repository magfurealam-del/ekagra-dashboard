import assert from 'node:assert/strict'
import test from 'node:test'
import { formatQueueDate, daysAgoLabel } from './types.ts'

test('visit dates do not shift to the previous day in a western timezone', () => {
  const old = process.env.TZ
  process.env.TZ = 'America/New_York'
  try {
    assert.equal(formatQueueDate('2026-11-07'), '07 Nov 2026')
    assert.equal(formatQueueDate('2026-10-26T20:00:00Z'), '27 Oct 2026')
    assert.equal(formatQueueDate('invalid'), '—')
  } finally {
    if (old === undefined) delete process.env.TZ
    else process.env.TZ = old
  }
})

test('relative queue dates use clinic calendar days instead of elapsed hours', () => {
  const now = Date.parse('2026-10-26T20:00:00Z') // 27 Oct, 02:00 BDT
  assert.equal(daysAgoLabel('2026-10-26T17:20:52Z', now), '1 day ago')
  assert.equal(daysAgoLabel('2026-10-26T19:00:00Z', now), 'today')
  assert.equal(daysAgoLabel('2026-10-28', now), 'tomorrow')
  assert.equal(daysAgoLabel(null, now), '')
  assert.equal(daysAgoLabel('invalid', now), '')
})

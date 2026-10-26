import assert from 'node:assert/strict'
import test from 'node:test'
import { formatWebsiteRequestTime } from './website-request-time.ts'

test('website request time uses Bangladesh time across midnight', () => {
  assert.equal(formatWebsiteRequestTime('2026-10-26T20:39:29.44819+00:00'), '27 Oct 2026, 02:39 am BDT')
  assert.equal(formatWebsiteRequestTime('2026-10-26T17:20:52Z'), '26 Oct 2026, 11:20 pm BDT')
  assert.equal(formatWebsiteRequestTime('2026-10-26T23:20:52+06:00'), '26 Oct 2026, 11:20 pm BDT')
})

test('missing, invalid and date-only values never invent a submission time', () => {
  for (const value of [null, undefined, '', 'invalid', '2026-10-26', '2026-10-26T17:20:52', 'invalidTZ']) {
    assert.equal(formatWebsiteRequestTime(value), null)
  }
})

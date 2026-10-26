import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clinicDate,
  rangeFor,
  previousRangeFor,
  percentage,
  change,
  validRange,
  snapshotAge,
  formatNumber,
} from './dashboard-presentation.ts'
test('Bangladesh presets roll over independently of the viewer timezone', () => {
  const now = new Date('2026-10-31T18:30:00Z')
  assert.equal(clinicDate(now), '2026-11-01')
  assert.deepEqual(rangeFor('month', '', '', now), {
    start: '2026-11-01',
    end: '2026-11-01',
  })
  assert.deepEqual(rangeFor('7d', '', '', now), {
    start: '2026-10-26',
    end: '2026-11-01',
  })
})
test('comparison windows preserve inclusive duration across leap days and DST', () => {
  assert.deepEqual(previousRangeFor('2024-03-01', '2024-03-07'), {
    start: '2024-02-23',
    end: '2024-02-29',
  })
  assert.deepEqual(previousRangeFor('2026-11-01', '2026-11-07'), {
    start: '2026-10-25',
    end: '2026-10-31',
  })
})
test('missing, zero, and zero-baseline values remain distinct', () => {
  assert.equal(formatNumber(undefined), '—')
  assert.equal(formatNumber(0), '0')
  assert.equal(percentage(undefined, 10), null)
  assert.equal(percentage(0, 0), null)
  assert.equal(percentage(0, 10), 0)
  assert.equal(change(10, 0), null)
  assert.equal(change(undefined, 10), null)
  assert.equal(change(80, 100), -20)
})
test('reject reversed, partial and impossible dates before requesting snapshots', () => {
  assert.equal(validRange('2026-02-30', '2026-03-05'), false)
  assert.equal(validRange('', '2026-10-25'), false)
  assert.equal(validRange('2026-10-25', '2026-10-01'), false)
  assert.equal(validRange('2026-10-25', '2026-10-25'), true)
  assert.equal(validRange('2024-01-01', '2024-12-31'), true)
  assert.equal(validRange('2024-01-01', '2025-01-01'), false)
})
test('daily-snapshot freshness has an explicit 26-hour grace window', () => {
  const now = Date.parse('2026-10-25T12:00:00Z')
  assert.equal(snapshotAge(null, now), 'unknown')
  assert.equal(snapshotAge('2026-10-24T09:59:00Z', now), 'stale')
  assert.equal(snapshotAge('2026-10-24T12:00:00Z', now), 'current')
})

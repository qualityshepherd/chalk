import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampDays, RETENTION_DAYS } from '../src/index.js'

test('clampDays: missing value defaults to 7', () => {
  assert.equal(clampDays(null), 7)
})

test('clampDays: valid value passes through', () => {
  assert.equal(clampDays('30'), 30)
})

test('clampDays: 90 matches the UI\'s "90d" option exactly', () => {
  assert.equal(clampDays('90'), 90)
})

// The year button is gone because the data behind it is - hits are swept at
// 90 days, so a 365-day window was 275 guaranteed-empty days.
test('clampDays: the old 365 now clamps to the retention window', () => {
  assert.equal(clampDays('365'), RETENTION_DAYS)
})

test('clampDays: above max clamps to the retention window', () => {
  assert.equal(clampDays('9999'), RETENTION_DAYS)
})

test('clampDays: negative value clamps to 1', () => {
  assert.equal(clampDays('-5'), 1)
})

test('clampDays: zero clamps to 1', () => {
  assert.equal(clampDays('0'), 1)
})

test('clampDays: non-numeric value defaults to 7', () => {
  assert.equal(clampDays('banana'), 7)
})

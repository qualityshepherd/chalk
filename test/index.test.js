import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampDays } from '../src/index.js'

test('clampDays: missing value defaults to 7', () => {
  assert.equal(clampDays(null), 7)
})

test('clampDays: valid value passes through', () => {
  assert.equal(clampDays('30'), 30)
})

test('clampDays: 365 matches the UI\'s "year" option exactly', () => {
  assert.equal(clampDays('365'), 365)
})

test('clampDays: above max clamps to 365', () => {
  assert.equal(clampDays('9999'), 365)
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

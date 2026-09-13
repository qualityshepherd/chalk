import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregate, groupSessions } from '../public/analytics-core.js'

// aggregate
test('aggregate: sums totalHits and totalBots across days', () => {
  const result = aggregate([
    { date: '2026-01-01', data: { totalHits: 10, bots: 2 } },
    { date: '2026-01-02', data: { totalHits: 5, bots: 1 } }
  ])
  assert.equal(result.totalHits, 15)
  assert.equal(result.totalBots, 3)
})

test('aggregate: merges byPath/byCountry/byReferrer counts for the same key across days', () => {
  const result = aggregate([
    { data: { byPath: { '/': 3, '/about': 1 }, byCountry: { US: 2 }, byReferrer: { 'example.com': 1 } } },
    { data: { byPath: { '/': 2 }, byCountry: { US: 1, GB: 1 }, byReferrer: { 'example.com': 2 } } }
  ])
  assert.deepEqual(result.byPath, { '/': 5, '/about': 1 })
  assert.deepEqual(result.byCountry, { US: 3, GB: 1 })
  assert.deepEqual(result.byReferrer, { 'example.com': 3 })
})

test('aggregate: byRss sums hits and per-aggregator counts, but takes the max of subscribers', () => {
  const result = aggregate([
    { data: { byRss: { main: { hits: 5, subscribers: 100, aggregators: { Feedly: 3 } } } } },
    { data: { byRss: { main: { hits: 2, subscribers: 80, aggregators: { Feedly: 1, NewsBlur: 2 } } } } }
  ])
  assert.deepEqual(result.byRss, {
    main: { hits: 7, subscribers: 100, aggregators: { Feedly: 4, NewsBlur: 2 } }
  })
})

test('aggregate: sums byDevice across days', () => {
  const result = aggregate([
    { data: { byDevice: { mobile: 3, desktop: 7 } } },
    { data: { byDevice: { mobile: 1, desktop: 2 } } }
  ])
  assert.deepEqual(result.byDevice, { mobile: 4, desktop: 9 })
})

test('aggregate: sums byHour and byDow elementwise', () => {
  const hourA = Array(24).fill(0); hourA[9] = 5
  const hourB = Array(24).fill(0); hourB[9] = 2; hourB[10] = 1
  const dowA = Array(7).fill(0); dowA[0] = 3
  const dowB = Array(7).fill(0); dowB[0] = 1; dowB[1] = 2
  const result = aggregate([{ data: { byHour: hourA, byDow: dowA } }, { data: { byHour: hourB, byDow: dowB } }])
  assert.equal(result.byHour[9], 7)
  assert.equal(result.byHour[10], 1)
  assert.equal(result.byDow[0], 4)
  assert.equal(result.byDow[1], 2)
})

test('aggregate: concatenates recentHits across days and sorts them newest-first', () => {
  const result = aggregate([
    { data: { recentHits: [{ ts: 100, path: '/a' }] } },
    { data: { recentHits: [{ ts: 300, path: '/b' }, { ts: 200, path: '/c' }] } }
  ])
  assert.deepEqual(result.recentHits.map(h => h.ts), [300, 200, 100])
})

test('aggregate: a day with no data (not yet populated) is skipped, not a crash', () => {
  const result = aggregate([
    { date: '2026-01-01', data: null },
    { date: '2026-01-02', data: { totalHits: 4 } }
  ])
  assert.equal(result.totalHits, 4)
})

test('aggregate: empty input produces zeroed-out shape, not undefined fields', () => {
  const result = aggregate([])
  assert.equal(result.totalHits, 0)
  assert.deepEqual(result.byDevice, { mobile: 0, desktop: 0 })
  assert.deepEqual(result.byHour, Array(24).fill(0))
  assert.deepEqual(result.recentHits, [])
})

// groupSessions
const hitAt = (ip, ts, path = '/') => ({ ip, ts, path })

test('groupSessions: single-day view (days=1) merges same-IP hits within the 30-minute gap into one session', () => {
  const hits = [hitAt('ip-1', 0, '/a'), hitAt('ip-1', 10 * 60 * 1000, '/b'), hitAt('ip-1', 20 * 60 * 1000, '/c')]
  const sessions = groupSessions(hits, 1)
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].hits.length, 3)
})

test('groupSessions: single-day view splits into a new session once the gap exceeds 30 minutes', () => {
  const hits = [hitAt('ip-1', 0, '/a'), hitAt('ip-1', 31 * 60 * 1000, '/b')]
  const sessions = groupSessions(hits, 1)
  assert.equal(sessions.length, 2)
  assert.equal(sessions[0].hits.length, 1)
  assert.equal(sessions[1].hits.length, 1)
})

test('groupSessions: multi-day view (days>1) merges same-IP, same-calendar-day hits into one session regardless of gap', () => {
  // toDateString() (what groupSessions uses) reads local time, so these are
  // built from local-time components rather than a UTC ISO string - a UTC
  // instant near midnight can land on a different local calendar day
  // depending on the machine's timezone, which would make this test flaky.
  const morning = new Date(2026, 0, 1, 8, 0).getTime()
  const evening = new Date(2026, 0, 1, 20, 0).getTime()
  const hits = [hitAt('ip-1', morning, '/a'), hitAt('ip-1', evening, '/b')]
  const sessions = groupSessions(hits, 7)
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].hits.length, 2)
})

test('groupSessions: multi-day view splits hits across a calendar-day boundary into separate sessions even if minutes apart', () => {
  const lateNight = new Date(2026, 0, 1, 23, 59).getTime()
  const earlyNext = new Date(2026, 0, 2, 0, 1).getTime()
  const hits = [hitAt('ip-1', lateNight, '/a'), hitAt('ip-1', earlyNext, '/b')]
  const sessions = groupSessions(hits, 7)
  assert.equal(sessions.length, 2)
})

test('groupSessions: different IPs always form separate sessions', () => {
  const hits = [hitAt('ip-1', 0, '/a'), hitAt('ip-2', 1000, '/b')]
  const sessions = groupSessions(hits, 1)
  assert.equal(sessions.length, 2)
})

test('groupSessions: sessions are sorted with the most recently started one first', () => {
  const hits = [hitAt('ip-1', 1000, '/a'), hitAt('ip-2', 5000, '/b')]
  const sessions = groupSessions(hits, 1)
  assert.equal(sessions[0].ip, 'ip-2')
  assert.equal(sessions[1].ip, 'ip-1')
})

test('groupSessions: per-hit fields default to empty string when missing, not undefined', () => {
  const sessions = groupSessions([{ ip: 'ip-1', ts: 0, path: '/a' }], 1)
  assert.deepEqual(sessions[0].hits[0], { path: '/a', ts: 0, referrer: '', device: '', asn: '', asOrganization: '', httpProtocol: '' })
})

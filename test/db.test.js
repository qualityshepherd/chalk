import { test } from 'node:test'
import assert from 'node:assert/strict'
import { purgeExpired } from '../src/db.js'
import { SESSION_TTL_MS } from '../src/auth.js'

const DAY = 86400000

// Captures what got bound to each statement in the batch, keyed by the table
// the SQL names - the order inside purgeExpired isn't the thing under test.
const fakeDb = (changes = [0, 0, 0, 0, 0]) => {
  const byTable = {}
  return {
    byTable,
    prepare: (sql) => ({
      bind: (...args) => {
        const table = sql.match(/DELETE FROM (\w+)/)[1]
        byTable[table] = { sql, args }
        return { sql, args }
      }
    }),
    batch: async (statements) => {
      assert.equal(statements.length, changes.length)
      return changes.map(c => ({ meta: { changes: c } }))
    }
  }
}

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0)

test('purgeExpired: hits cut off at exactly retentionDays back', async () => {
  const db = fakeDb()
  await purgeExpired(db, NOW, 90)
  assert.deepEqual(db.byTable.hits.args, [NOW - 90 * DAY])
})

test('purgeExpired: retention window is a parameter, not baked in', async () => {
  const db = fakeDb()
  await purgeExpired(db, NOW, 30)
  assert.deepEqual(db.byTable.hits.args, [NOW - 30 * DAY])
})

test('purgeExpired: bot_counts cut off by date string, matching its PK', async () => {
  const db = fakeDb()
  await purgeExpired(db, NOW, 90)
  assert.deepEqual(db.byTable.bot_counts.args, [new Date(NOW - 90 * DAY).toISOString().slice(0, 10)])
})

// These go by reset_at, not the retention cutoff - an expired rate-limit row
// is already dead weight, so there's no reason to keep it 90 days.
test('purgeExpired: rate-limit tables sweep on expiry, not on retention', async () => {
  const db = fakeDb()
  await purgeExpired(db, NOW, 90)
  assert.deepEqual(db.byTable.login_attempts.args, [NOW])
  assert.deepEqual(db.byTable.challenge_attempts.args, [NOW])
})

test('purgeExpired: sessions sweep at the session TTL', async () => {
  const db = fakeDb()
  await purgeExpired(db, NOW, 90)
  assert.deepEqual(db.byTable.sessions.args, [NOW - SESSION_TTL_MS])
})

test('purgeExpired: reports both rate-limit tables as one number', async () => {
  const result = await purgeExpired(fakeDb([12, 3, 4, 5, 1]), NOW, 90)
  assert.deepEqual(result, { hits: 12, botCounts: 3, rateLimits: 9, sessions: 1 })
})

// D1 populates meta.changes, but a cron that throws on a missing field would
// stop sweeping over a detail nobody would think to check.
test('purgeExpired: missing meta counts as zero rather than throwing', async () => {
  const db = fakeDb()
  db.batch = async () => [{}, {}, {}, {}, {}]
  assert.deepEqual(await purgeExpired(db, NOW, 90), { hits: 0, botCounts: 0, rateLimits: 0, sessions: 0 })
})

import { isSessionExpired, isNonceExpired, hashToken } from './auth.js'

export async function insertHit (db, hit) {
  await db.prepare(
    'INSERT INTO hits (domain, ts, path, country, city, region, device, referrer, ip_hash, asn, rss_feed, rss_subs, as_organization, http_protocol) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    hit.domain, hit.ts, hit.path, hit.country || null, hit.city || null,
    hit.region || null, hit.device || null, hit.referrer || null,
    hit.ip_hash || null, hit.asn || null,
    hit.rss_feed || null, hit.rss_subs || null,
    hit.as_organization || null, hit.http_protocol || null
  ).run()
  // Keeps the domain nav's source cheap - getDomains() reads this instead of
  // scanning the full (unboundedly growing) hits table on every dashboard load.
  await db.prepare('INSERT OR IGNORE INTO domains (domain) VALUES (?)').bind(hit.domain).run()
}

export async function incrementBotCount (db, domain, date) {
  await db.prepare(
    'INSERT INTO bot_counts (domain, date, count) VALUES (?,?,1) ON CONFLICT(domain,date) DO UPDATE SET count=count+1'
  ).bind(domain, date).run()
}

// If a query ever returns exactly this many rows, there may be more within
// the requested window that got cut off - callers should treat that as a
// signal to warn, not silently aggregate a partial result as if complete.
export const HITS_QUERY_LIMIT = 20000

export async function queryHits (db, domain, since) {
  const { results } = await db.prepare(
    `SELECT ts, path, country, city, region, device, referrer, ip_hash, asn, rss_feed, rss_subs, as_organization, http_protocol FROM hits WHERE domain=? AND ts>=? ORDER BY ts DESC LIMIT ${HITS_QUERY_LIMIT}`
  ).bind(domain, since).all()
  return results
}

export async function queryBotCounts (db, domain, sinceDate) {
  const { results } = await db.prepare(
    'SELECT date, count FROM bot_counts WHERE domain=? AND date>=? ORDER BY date DESC'
  ).bind(domain, sinceDate).all()
  return results
}

export async function getDomains (db) {
  const { results } = await db.prepare(
    'SELECT domain FROM domains ORDER BY domain'
  ).all()
  return results.map(r => r.domain)
}

// Auth

export async function createNonce (db, nonce) {
  await db.prepare('INSERT INTO nonces (nonce, created_at) VALUES (?,?)').bind(nonce, Date.now()).run()
  await db.prepare('DELETE FROM nonces WHERE created_at < ?').bind(Date.now() - 10 * 60 * 1000).run()
}

export async function consumeNonce (db, nonce) {
  // Atomic: DELETE ... RETURNING means only one concurrent request racing
  // on the same nonce can get the row back - a second request gets null,
  // not the timestamp, so the same challenge can't be consumed twice.
  const row = await db.prepare('DELETE FROM nonces WHERE nonce=? RETURNING created_at').bind(nonce).first()
  if (!row) return false
  return !isNonceExpired(row.created_at, Date.now())
}

export async function createSession (db, token) {
  const hash = await hashToken(token)
  await db.prepare('INSERT INTO sessions (token, created_at) VALUES (?,?)').bind(hash, Date.now()).run()
}

export async function getValidSession (db, token) {
  const hash = await hashToken(token)
  const row = await db.prepare('SELECT created_at FROM sessions WHERE token=?').bind(hash).first()
  if (!row) return null
  if (isSessionExpired(row.created_at, Date.now())) {
    await db.prepare('DELETE FROM sessions WHERE token=?').bind(hash).run().catch(() => {})
    return null
  }
  return row
}

export async function deleteSession (db, token) {
  const hash = await hashToken(token)
  await db.prepare('DELETE FROM sessions WHERE token=?').bind(hash).run()
}

// table is interpolated into SQL below - restrict it to a known set so this
// can't become an injection vector if a future callsite passes it dynamically.
const RATE_LIMIT_TABLES = new Set(['login_attempts', 'challenge_attempts'])

export async function getRateLimit (db, table, ip) {
  if (!RATE_LIMIT_TABLES.has(table)) throw new Error('invalid rate limit table')
  const row = await db.prepare(`SELECT count, reset_at FROM ${table} WHERE ip=?`).bind(ip).first()
  return row ? { count: row.count, resetAt: row.reset_at } : null
}

// Atomic: the count/reset_at transition happens inside the UPSERT itself,
// so two concurrent requests from the same IP can't both read the same
// stale count and each write count+1, silently losing an attempt (which
// is exactly what the old getRateLimit-then-setRateLimit sequence allowed).
export async function incrementRateLimit (db, table, ip, now, windowMs) {
  if (!RATE_LIMIT_TABLES.has(table)) throw new Error('invalid rate limit table')
  const resetAt = now + windowMs
  await db.prepare(
    `INSERT INTO ${table} (ip, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(ip) DO UPDATE SET
       count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
       reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END`
  ).bind(ip, resetAt, now, now, resetAt).run()
}

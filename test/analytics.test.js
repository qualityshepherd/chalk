import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBot, isDatacenter, parseDevice, parseRssSubscribers, sanitizeHitPayload, botSignals, getBotFlaggedIps } from '../src/analytics-core.js'

test('isBot: wp-login is a bot', () => {
  assert.equal(isBot('/wp-login.php', 'Mozilla/5.0'), true)
})

test('isBot: .env path is a bot', () => {
  assert.equal(isBot('/.env', 'Mozilla/5.0'), true)
})

test('isBot: normal post path with browser UA is not a bot', () => {
  assert.equal(isBot('/posts/hello', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), false)
})

test('isBot: root path is not a bot', () => {
  assert.equal(isBot('/', 'Mozilla/5.0'), false)
})

test('isBot: path with query string is not a bot', () => {
  assert.equal(isBot('/?t=javascript', 'Mozilla/5.0'), false)
})

test('isBot: bot prefix /wp- is a bot', () => {
  assert.equal(isBot('/wp-admin/', 'Mozilla/5.0'), true)
})

test('isBot: empty UA is suspicious but path-driven', () => {
  assert.equal(isBot('/', ''), false)
  assert.equal(isBot('/wp-login.php', ''), true)
})

test('isBot: slackbot UA is a bot', () => {
  assert.equal(isBot('/', 'Slackbot-LinkExpanding 1.0'), true)
})

test('isBot: WordPress rest_route scanner probe is a bot', () => {
  assert.equal(isBot('/?rest_route=/batch/v1', 'Mozilla/5.0'), true)
  assert.equal(isBot('/blog/?rest_route=%2Fbatch%2Fv1', 'Mozilla/5.0'), true)
})

test('isBot: WordPress wp/v2 path anywhere (not just as a prefix) is a bot', () => {
  assert.equal(isBot('/blog/wp/v2/posts/9999999', 'Mozilla/5.0'), true)
})

test('isBot: /ip probe is a bot', () => {
  assert.equal(isBot('/ip', 'Mozilla/5.0'), true)
})

test('isBot: bare /env scanner probe is a bot', () => {
  assert.equal(isBot('/env', 'Mozilla/5.0'), true)
})

test('isBot: nodeinfo discovery probes are a bot', () => {
  assert.equal(isBot('/.well-known/nodeinfo', 'Mozilla/5.0'), true)
  assert.equal(isBot('/nodeinfo/2.1', 'Mozilla/5.0'), true)
})

// favicon/robots.txt/sitemap/manifest.json are universal across every site
// this app forwards hits from - centralized here instead of duplicated in
// each app's own shouldSkip.
test('isBot: favicon requests are a bot', () => {
  assert.equal(isBot('/favicon.ico', 'Mozilla/5.0'), true)
})

test('isBot: robots.txt is a bot', () => {
  assert.equal(isBot('/robots.txt', 'Mozilla/5.0'), true)
})

test('isBot: sitemap requests are a bot', () => {
  assert.equal(isBot('/sitemap.xml', 'Mozilla/5.0'), true)
})

test('isBot: manifest.json is a bot', () => {
  assert.equal(isBot('/manifest.json', 'Mozilla/5.0'), true)
})

test('isDatacenter: known datacenter ASN returns true', () => {
  assert.equal(isDatacenter(14618), true) // AWS
  assert.equal(isDatacenter(15169), true) // Google Cloud
  assert.equal(isDatacenter(136907), true) // Huawei Cloud
})

test('isDatacenter: unknown ASN returns false', () => {
  assert.equal(isDatacenter(12345), false)
})

test('isDatacenter: null/undefined ASN is falsy', () => {
  assert.ok(!isDatacenter(null))
  assert.ok(!isDatacenter(undefined))
})

test('isDatacenter: string ASN is coerced', () => {
  assert.equal(isDatacenter('14618'), true)
})

test('parseDevice: mobile UA returns mobile', () => {
  assert.equal(parseDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'mobile')
})

test('parseDevice: Android UA returns mobile', () => {
  assert.equal(parseDevice('Mozilla/5.0 (Linux; Android 13; Pixel 7)'), 'mobile')
})

test('parseDevice: desktop UA returns desktop', () => {
  assert.equal(parseDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'), 'desktop')
})

test('parseDevice: empty UA returns desktop', () => {
  assert.equal(parseDevice(''), 'desktop')
})

test('parseRssSubscribers: Feedly subscriber count', () => {
  const result = parseRssSubscribers('Feedly/1.0 (42 subscribers; https://feedly.com/i/subscription/feed/...)')
  assert.equal(result?.aggregator, 'Feedly')
  assert.equal(result?.subscribers, 42)
})

test('parseRssSubscribers: Feedbin subscriber count', () => {
  const result = parseRssSubscribers('Feedbin feed-id:123456 - 7 subscribers')
  assert.equal(result?.aggregator, 'Feedbin')
  assert.equal(result?.subscribers, 7)
})

test('parseRssSubscribers: unknown UA returns null', () => {
  assert.equal(parseRssSubscribers('Mozilla/5.0'), null)
})

test('parseRssSubscribers: empty UA returns null', () => {
  assert.equal(parseRssSubscribers(''), null)
})

// sanitizeHitPayload: status field
const basePayload = { domain: 'example.com', path: '/', ip: '1.2.3.4' }

test('sanitizeHitPayload: accepts a valid status code', () => {
  const hit = sanitizeHitPayload({ ...basePayload, status: 404 })
  assert.equal(hit.status, 404)
})

test('sanitizeHitPayload: rejects a non-integer status', () => {
  const hit = sanitizeHitPayload({ ...basePayload, status: '404' })
  assert.equal(hit.status, undefined)
})

test('sanitizeHitPayload: rejects an out-of-range status', () => {
  const hit = sanitizeHitPayload({ ...basePayload, status: 99 })
  assert.equal(hit.status, undefined)
  assert.equal(sanitizeHitPayload({ ...basePayload, status: 600 }).status, undefined)
})

test('sanitizeHitPayload: missing status is fine', () => {
  const hit = sanitizeHitPayload(basePayload)
  assert.equal(hit.status, undefined)
})

// botSignals / BOT_DETECTORS - pathVelocity (the only detector - status is
// irrelevant, only breadth of distinct pages counts)
const hitAt = (ts, path, status = 200) => ({ ts, path, status })

test('botSignals: 4 distinct paths within 15s is flagged', () => {
  const hits = [
    hitAt(0, '/now'), hitAt(4000, '/friends'), hitAt(8000, '/ideas'), hitAt(12000, '/uses')
  ]
  assert.deepEqual(botSignals(hits), ['rapid multi-page crawl'])
})

test('botSignals: 4 distinct paths with mixed status within 15s is flagged (status is irrelevant)', () => {
  const hits = [
    hitAt(0, '/now', 200), hitAt(4000, '/friends', 404), hitAt(8000, '/ideas', 200), hitAt(12000, '/uses', 404)
  ]
  assert.deepEqual(botSignals(hits), ['rapid multi-page crawl'])
})

test('botSignals: same path repeated many times is NOT flagged (Rando reroll case)', () => {
  const hits = Array.from({ length: 10 }, (_, i) => hitAt(i * 1000, '/'))
  assert.deepEqual(botSignals(hits), [])
})

test('botSignals: same path 404ing repeatedly is also NOT flagged - diversity, not repetition, is the signal', () => {
  const hits = [hitAt(0, '/dead', 404), hitAt(4000, '/dead', 404), hitAt(8000, '/dead', 404), hitAt(12000, '/dead', 404)]
  assert.deepEqual(botSignals(hits), [])
})

test('botSignals: 4 distinct paths spread across more than 15s is NOT flagged', () => {
  const hits = [
    hitAt(0, '/now'), hitAt(6000, '/friends'), hitAt(12000, '/ideas'), hitAt(18000, '/uses')
  ]
  assert.deepEqual(botSignals(hits), [])
})

test('botSignals: 3 distinct paths within 15s is NOT enough', () => {
  const hits = [hitAt(0, '/now'), hitAt(4000, '/friends'), hitAt(8000, '/ideas')]
  assert.deepEqual(botSignals(hits), [])
})

// getBotFlaggedIps
test('getBotFlaggedIps: flags only the IP matching a burst pattern', () => {
  const hits = [
    { ip_hash: 'bot-ip', ...hitAt(0, '/now') },
    { ip_hash: 'bot-ip', ...hitAt(4000, '/friends') },
    { ip_hash: 'bot-ip', ...hitAt(8000, '/ideas') },
    { ip_hash: 'bot-ip', ...hitAt(12000, '/uses') },
    { ip_hash: 'human-ip', ...hitAt(0, '/') },
    { ip_hash: 'human-ip', ...hitAt(20000, '/about') }
  ]
  const flagged = getBotFlaggedIps(hits)
  assert.equal(flagged.has('bot-ip'), true)
  assert.equal(flagged.has('human-ip'), false)
})

test('getBotFlaggedIps: hits are grouped and sorted per IP regardless of input order', () => {
  const hits = [
    { ip_hash: 'bot-ip', ...hitAt(12000, '/uses') },
    { ip_hash: 'bot-ip', ...hitAt(0, '/now') },
    { ip_hash: 'bot-ip', ...hitAt(8000, '/ideas') },
    { ip_hash: 'bot-ip', ...hitAt(4000, '/friends') }
  ]
  assert.equal(getBotFlaggedIps(hits).has('bot-ip'), true)
})

test('getBotFlaggedIps: ignores hits with no ip_hash', () => {
  const hits = [hitAt(0, '/now'), hitAt(4000, '/friends'), hitAt(8000, '/ideas'), hitAt(12000, '/uses')]
  assert.equal(getBotFlaggedIps(hits).size, 0)
})

// getBotFlaggedIps: ASN-pooled path-velocity burst - catches a scanner or
// content scraper rotating through several IPs on one hosting provider or
// residential ISP (one page per IP), where no single IP alone crosses the
// per-IP distinct-path threshold.
test('getBotFlaggedIps: 4 IPs on the same ASN each loading one distinct page in the burst are all flagged', () => {
  const hits = [
    { ip_hash: 'ip-1', asn: 'AS1234', ...hitAt(0, '/a') },
    { ip_hash: 'ip-2', asn: 'AS1234', ...hitAt(4000, '/b') },
    { ip_hash: 'ip-3', asn: 'AS1234', ...hitAt(8000, '/c') },
    { ip_hash: 'ip-4', asn: 'AS1234', ...hitAt(12000, '/d') }
  ]
  const flagged = getBotFlaggedIps(hits)
  for (const ip of ['ip-1', 'ip-2', 'ip-3', 'ip-4']) assert.equal(flagged.has(ip), true)
})

test('getBotFlaggedIps: ASN pooling ignores status - a mix of 200s and 404s across the ASN still counts as a distinct-path burst', () => {
  const hits = [
    { ip_hash: 'ip-1', asn: 'AS1234', ...hitAt(0, '/a', 200) },
    { ip_hash: 'ip-2', asn: 'AS1234', ...hitAt(4000, '/b', 404) },
    { ip_hash: 'ip-3', asn: 'AS1234', ...hitAt(8000, '/c', 200) },
    { ip_hash: 'ip-4', asn: 'AS1234', ...hitAt(12000, '/d', 404) }
  ]
  const flagged = getBotFlaggedIps(hits)
  for (const ip of ['ip-1', 'ip-2', 'ip-3', 'ip-4']) assert.equal(flagged.has(ip), true)
})

test('getBotFlaggedIps: an IP on the same ASN but outside the triggering window is not flagged', () => {
  const hits = [
    { ip_hash: 'ip-1', asn: 'AS1234', ...hitAt(0, '/a') },
    { ip_hash: 'ip-2', asn: 'AS1234', ...hitAt(4000, '/b') },
    { ip_hash: 'ip-3', asn: 'AS1234', ...hitAt(8000, '/c') },
    { ip_hash: 'ip-4', asn: 'AS1234', ...hitAt(12000, '/d') },
    { ip_hash: 'late-ip', asn: 'AS1234', ...hitAt(120000, '/e') }
  ]
  assert.equal(getBotFlaggedIps(hits).has('late-ip'), false)
})

test('getBotFlaggedIps: 3 distinct paths across an ASN is not enough to flag anyone', () => {
  const hits = [
    { ip_hash: 'ip-1', asn: 'AS1234', ...hitAt(0, '/a') },
    { ip_hash: 'ip-2', asn: 'AS1234', ...hitAt(4000, '/b') },
    { ip_hash: 'ip-3', asn: 'AS1234', ...hitAt(8000, '/c') }
  ]
  assert.equal(getBotFlaggedIps(hits).size, 0)
})

test('getBotFlaggedIps: several IPs on the same ASN all loading the SAME path is NOT pooled as a burst (e.g. an ISP full of real visitors hitting the homepage)', () => {
  const hits = [
    { ip_hash: 'ip-1', asn: 'AS1234', ...hitAt(0, '/') },
    { ip_hash: 'ip-2', asn: 'AS1234', ...hitAt(4000, '/') },
    { ip_hash: 'ip-3', asn: 'AS1234', ...hitAt(8000, '/') },
    { ip_hash: 'ip-4', asn: 'AS1234', ...hitAt(12000, '/') }
  ]
  assert.equal(getBotFlaggedIps(hits).size, 0)
})

test('getBotFlaggedIps: hits with no asn are ignored by ASN pooling without crashing', () => {
  const hits = [
    { ip_hash: 'ip-1', ...hitAt(0, '/a') },
    { ip_hash: 'ip-2', ...hitAt(4000, '/b') },
    { ip_hash: 'ip-3', ...hitAt(8000, '/c') }
  ]
  assert.equal(getBotFlaggedIps(hits).size, 0)
})

// getBotFlaggedIps: explicit semantics tests, per external review
// (flagging is per-IP-for-the-whole-window, and bots/totalHits are both
// hit-counts, not visitor-counts - see the comment in index.js)
test('getBotFlaggedIps: 4 hits in one burst is one flagged IP, which becomes 4 excluded/bot hits downstream', () => {
  const hits = [
    { ip_hash: 'bot-ip', ...hitAt(0, '/now') },
    { ip_hash: 'bot-ip', ...hitAt(4000, '/friends') },
    { ip_hash: 'bot-ip', ...hitAt(8000, '/ideas') },
    { ip_hash: 'bot-ip', ...hitAt(12000, '/uses') }
  ]
  const flagged = getBotFlaggedIps(hits)
  assert.equal(flagged.size, 1)
  // This is the exact check handleAnalyticsData uses per-hit to decide
  // exclusion - confirming it yields 4 excluded hits, not 1, since bots/
  // totalHits are hit-counts (matching incrementBotCount's pre-existing
  // per-hit semantics), not unique-visitor counts.
  const excludedHits = hits.filter(h => flagged.has(h.ip_hash))
  assert.equal(excludedHits.length, 4)
})

test('getBotFlaggedIps: flags an IP for its whole window, including hits well before the burst that triggered it', () => {
  const hits = [
    { ip_hash: 'shared-ip', ...hitAt(0, '/normal-page-1') },
    { ip_hash: 'shared-ip', ...hitAt(60000, '/normal-page-2') },
    // burst starts one minute later
    { ip_hash: 'shared-ip', ...hitAt(120000, '/now') },
    { ip_hash: 'shared-ip', ...hitAt(124000, '/friends') },
    { ip_hash: 'shared-ip', ...hitAt(128000, '/ideas') },
    { ip_hash: 'shared-ip', ...hitAt(132000, '/uses') }
  ]
  const flagged = getBotFlaggedIps(hits)
  assert.equal(flagged.has('shared-ip'), true)
  // Deliberate: the two early, individually unremarkable hits get excluded
  // too, not just the 4 burst hits - there's no way to draw a clean line
  // mid-visitor between "before" and "after" they were confirmed automated.
  const excludedHits = hits.filter(h => flagged.has(h.ip_hash))
  assert.equal(excludedHits.length, 6)
})

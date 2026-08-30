import ANALYTICS_TEMPLATE from './analyticsTemplate.js'
import {
  insertHit, incrementBotCount, queryHits, queryBotCounts, getDomains,
  createNonce, consumeNonce, createSession, getValidSession, deleteSession,
  getRateLimit, setRateLimit
} from './db.js'
import {
  parseCookies, sessionCookie, clearedSessionCookie, generateNonce, generateSessionToken,
  isAuthorizedPubkey, verifySignature, hexToBytes, isRateLimited, incrementAttempt,
  SESSION_TTL_MS, LOGIN_RATE_LIMIT_MAX_ATTEMPTS, LOGIN_RATE_LIMIT_WINDOW_MS
} from './auth.js'
import { isBot, isDatacenter, parseDevice, parseRssSubscribers, hashIp } from './analytics-core.js'

const COOKIE_NAME = 'chalk_session'

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json' }
})

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
}

async function getSession (req, env) {
  const token = parseCookies(req.headers.get('Cookie'))[COOKIE_NAME]
  if (!token) return null
  return getValidSession(env.DB, token)
}

function withAuth (handler) {
  return async (req, env, ctx, ...extra) => {
    const session = await getSession(req, env)
    if (!session) {
      const isApi = new URL(req.url).pathname.startsWith('/api/')
      if (isApi) return json({ error: 'unauthorized' }, 401)
      return new Response(null, { status: 302, headers: { Location: '/login' } })
    }
    return handler(req, env, ctx, session, ...extra)
  }
}

// POST /hit — called by client sites (fire-and-forget). Sites forward raw
// signal only (ua, ip, geo) — chalk is the single place bot/device/RSS
// classification happens, so every property is judged the same way.
async function handleHit (req, env) {
  const secret = req.headers.get('x-hit-secret') || ''
  if (!env.HIT_SECRET || secret !== env.HIT_SECRET) {
    return new Response('forbidden', { status: 403 })
  }

  let payload
  try { payload = await req.json() } catch { return new Response('bad request', { status: 400 }) }

  const { domain, path, country, city, region, referrer, asn, ua, ip, rss_feed: rssFeed, ts } = payload
  if (!domain || !path || !ip) return new Response('bad request', { status: 400 })

  const timestamp = ts || Date.now()

  // RSS/podcast crawlers routinely run from datacenter ASNs (AWS, GCP,
  // Azure) — that's normal for feed-fetching infrastructure, not evidence
  // of a scanner. The app already told us this path is a feed route by
  // setting rss_feed; trust that and skip bot/datacenter classification
  // entirely rather than losing subscriber tracking to a false positive.
  if (!rssFeed && (isBot(path, ua) || isDatacenter(asn))) {
    const date = new Date(timestamp).toISOString().slice(0, 10)
    await incrementBotCount(env.DB, domain, date).catch(() => {})
    return new Response('ok')
  }

  const device = parseDevice(ua)
  const rss = rssFeed ? parseRssSubscribers(ua) : null
  const ipHash = await hashIp(ip)

  await insertHit(env.DB, {
    domain,
    ts: timestamp,
    path,
    country,
    city,
    region,
    device,
    referrer,
    ip_hash: ipHash,
    asn,
    rss_feed: rssFeed || null,
    rss_subs: rss ? rss.subscribers : null
  }).catch(() => {})

  return new Response('ok')
}

// GET /api/analytics?domain=brine.dev&days=7
const handleAnalyticsData = withAuth(async (req, env) => {
  const url = new URL(req.url)
  const domain = url.searchParams.get('domain')
  const days = Math.min(parseInt(url.searchParams.get('days') || '7'), 90)

  if (!domain) {
    const domains = await getDomains(env.DB)
    return json({ domains })
  }

  const startDate = new Date()
  startDate.setUTCHours(0, 0, 0, 0)
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1))
  const since = startDate.getTime()
  const sinceDate = startDate.toISOString().slice(0, 10)

  const [hits, botCounts] = await Promise.all([
    queryHits(env.DB, domain, since),
    queryBotCounts(env.DB, domain, sinceDate)
  ])

  const botCountMap = new Map(botCounts.map(row => [row.date, row.count]))

  const dayMap = new Map()
  const getDay = (date) => {
    if (!dayMap.has(date)) {
      dayMap.set(date, {
        date,
        totalHits: 0,
        byPath: {},
        byHour: Array(24).fill(0),
        byDow: Array(7).fill(0),
        byCountry: {},
        byCity: {},
        byReferrer: {},
        byDevice: { mobile: 0, desktop: 0 },
        byRss: {},
        recentHits: [],
        _ips: new Set()
      })
    }
    return dayMap.get(date)
  }

  for (let i = 0; i < days; i++) {
    const dateCursor = new Date()
    dateCursor.setUTCDate(dateCursor.getUTCDate() - i)
    getDay(dateCursor.toISOString().slice(0, 10))
  }

  for (const hit of hits) {
    const date = new Date(hit.ts).toISOString().slice(0, 10)
    if (!dayMap.has(date)) continue
    const day = dayMap.get(date)

    if (hit.rss_feed) {
      const prev = day.byRss[hit.rss_feed] || { hits: 0, subscribers: 0 }
      day.byRss[hit.rss_feed] = { hits: prev.hits + 1, subscribers: Math.max(prev.subscribers, hit.rss_subs || 0) }
      continue
    }

    day.totalHits++
    day._ips.add(hit.ip_hash)
    day.byPath[hit.path] = (day.byPath[hit.path] || 0) + 1
    day.byHour[new Date(hit.ts).getUTCHours()]++
    day.byDow[new Date(hit.ts).getUTCDay()]++
    if (hit.country) day.byCountry[hit.country] = (day.byCountry[hit.country] || 0) + 1
    if (hit.city) day.byCity[hit.city] = (day.byCity[hit.city] || 0) + 1
    if (hit.referrer) {
      try {
        const referrerHost = new URL(hit.referrer).hostname
        day.byReferrer[referrerHost] = (day.byReferrer[referrerHost] || 0) + 1
      } catch {}
    }
    day.byDevice[hit.device || 'desktop'] = (day.byDevice[hit.device || 'desktop'] || 0) + 1
    if (day.recentHits.length < 100) {
      day.recentHits.push({ ts: hit.ts, path: hit.path, country: hit.country, region: hit.region, city: hit.city, ip: hit.ip_hash, referrer: hit.referrer, device: hit.device })
    }
  }

  const result = [...dayMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, day]) => {
      const { _ips, ...rest } = day
      return { date, data: { ...rest, bots: botCountMap.get(date) || 0, uniques: _ips.size } }
    })

  return json(result)
})

// Auth routes
async function handleChallenge (req, env) {
  const nonce = generateNonce()
  await createNonce(env.DB, nonce)
  return json({ challenge: nonce, configured: !!env.AUTH_PUBKEY })
}

async function handleLogin (req, env) {
  const ip = req.headers.get('cf-connecting-ip') || 'unknown'
  const record = await getRateLimit(env.DB, ip)
  if (isRateLimited(record, Date.now(), LOGIN_RATE_LIMIT_MAX_ATTEMPTS)) {
    return json({ error: 'too many attempts' }, 429)
  }

  const { pubkey, challenge, sig } = await req.json().catch(() => ({}))
  if (!pubkey || !challenge || !sig) return json({ error: 'missing fields' }, 400)

  const valid = await consumeNonce(env.DB, challenge)
  if (!valid) return json({ error: 'invalid or expired challenge' }, 401)

  if (!isAuthorizedPubkey(pubkey, env)) {
    const next = incrementAttempt(record, Date.now(), LOGIN_RATE_LIMIT_WINDOW_MS)
    await setRateLimit(env.DB, ip, next)
    return json({ error: 'unauthorized' }, 401)
  }

  const verified = await verifySignature(challenge, sig, hexToBytes(pubkey))
  if (!verified) {
    const next = incrementAttempt(record, Date.now(), LOGIN_RATE_LIMIT_WINDOW_MS)
    await setRateLimit(env.DB, ip, next)
    return json({ error: 'signature invalid' }, 401)
  }

  const token = generateSessionToken()
  await createSession(env.DB, token)

  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(token, COOKIE_NAME, SESSION_TTL_MS / 1000)
    }
  })
}

const handleLogout = withAuth(async (req, env, ctx, session) => {
  const token = parseCookies(req.headers.get('Cookie'))[COOKIE_NAME]
  await deleteSession(env.DB, token)
  return new Response(null, {
    status: 302,
    headers: { Location: '/login', 'Set-Cookie': clearedSessionCookie(COOKIE_NAME) }
  })
})

// Dashboard HTML — ANALYTICS_TEMPLATE is a complete standalone document
async function handleDashboard (req, env) {
  const session = await getSession(req, env)
  if (!session) return new Response(null, { status: 302, headers: { Location: '/login' } })
  return new Response(ANALYTICS_TEMPLATE, { headers: { 'Content-Type': 'text/html;charset=UTF-8', ...SECURITY_HEADERS } })
}

export default {
  async fetch (req, env, ctx) {
    const url = new URL(req.url)
    const { pathname } = url
    const method = req.method

    if (method === 'POST' && pathname === '/hit') return handleHit(req, env)
    if (method === 'GET' && pathname === '/api/challenge') return handleChallenge(req, env)
    if (method === 'POST' && pathname === '/api/login') return handleLogin(req, env)
    if (method === 'POST' && pathname === '/api/logout') return handleLogout(req, env, ctx)
    if (method === 'GET' && pathname === '/api/analytics') return handleAnalyticsData(req, env, ctx)
    if (method === 'GET' && (pathname === '/' || pathname === '/analytics')) return handleDashboard(req, env)
    if (method === 'GET' && pathname === '/login') return env.ASSETS.fetch(new Request(new URL('/login.html', req.url), req))

    return env.ASSETS.fetch(req)
  }
}

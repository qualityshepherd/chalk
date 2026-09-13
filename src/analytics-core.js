// filters because BOTS ARE FUCKING FUN...

const BOT_PREFIXES = [
  '/account/', '/api/v1', '/back/', '/bak/', '/billing/', '/cgi-bin/', '/checkout',
  '/conf.d/', '/donate', '/env', '/error/', '/etc/', '/favicon', '/file-upload', '/fileupload',
  '/files/', '/form/', '/import/', '/info', '/ip', '/log/', '/login',
  '/manifest.json', '/mcp', '/officialsite', '/old/', '/opt/', '/order/', '/php-cgi', '/phpinfo', '/plans/',
  '/proc/', '/register', '/rest/', '/restore/', '/robots.txt', '/root/', '/shop/', '/sitemap', '/sse',
  '/storage/', '/subscribe', '/temp', '/test', '/tmp', '/upload',
  '/v1/', '/v2/', '/v3/', '/var/', '/vendor', '/wallet/', '/webhook/', '/wp-'
]

const BOT_PATHS = [
  '%24', '%3c', '%3e', '%40vite', '%7b', '${', '../', '..\\', '<', '"/',
  '.asp', '.aspx', '.aws', '.ds_store', '.env',
  '.git', '.npmrc', '.php', '.sql', '.vscode',
  '@vite', 'actuator', 'admin', 'alvin9999', 'backup',
  'cgi-bin', 'composer.json', 'computemetadata', 'config',
  'console/', 'credentials', 'debug.log',
  'ediscovery', 'ecp/current', 'graphql',
  'https%3a', 'latest/meta-data', 'login.action',
  'meta-inf', 'metadata/', 'nodeinfo', 'package.json',
  'passwd', 'php_info', 'phpinfo', 'pom.properties', 'requirements.txt',
  'rest_route=', 'security.txt', 'server-status', 'setup', 'shell',
  'statistics.json', 'swagger', 'telescope',
  'trace.axd', 'wp-', '/wp/', 'xmlrpc', 'application.zip', 'latest.zip', 'public_html.rar'
]

const BOT_UAS = [
  'discordbot', 'facebookexternalhit', 'linkexpander',
  'preview', 'slackbot', 'twitterbot'
]

const BOT_ASNS = new Set([
  8075, // Microsoft Azure
  14061, // DigitalOcean
  14618, // AWS
  15169, // Google Cloud
  16276, // OVH
  16509, // AWS
  19551, // Incapsula
  20473, // Vultr
  24940, // Hetzner
  51167, // Contabo (very common scanner source)
  9009, // M247 (Romanian provider, tons of scanner traffic)
  63949, // Linode/Akamai
  211590, // Scaleway - Paris scanner
  396982, // Google Cloud
  136907, // Huawei Cloud (Singapore)
  45090, // Tencent Cloud
  400940, // Railway (app hosting platform)
  47583, // Hostinger
  136557, // Host Universal
  205544, // Leaseweb
  197540, // netcup
  53667, // FranTech Solutions (BuyVM)
  12574, // Hosting.de
  202422, // G-Core Labs
  140641, // Cloudtechtiq Technologies
  34343, // Base IP B.V.
  23033, // Wowrack.com
  209366 // SEMrush (SEO crawler)
])

// Known RSS aggregator UA patterns that include subscriber counts
const RSS_SUBSCRIBER_PATTERNS = [
  { re: /Feedbin feed-id:\S+ - (\d+) subscribers?/i, name: 'Feedbin' },
  { re: /NewsBlur\/(\d+) subscribers?/i, name: 'NewsBlur' },
  { re: /inoreader\.com[^)]*\+(\d+) subscribers?\)/i, name: 'Inoreader' },
  { re: /The Old Reader.*?(\d+) subscribers?/i, name: 'TheOldReader' },
  { re: /Feedly\/1\.0 \((\d+) subscribers?/i, name: 'Feedly' }
]

export const parseRssSubscribers = (ua) => {
  if (!ua) return null
  for (const { re, name } of RSS_SUBSCRIBER_PATTERNS) {
    const match = ua.match(re)
    if (match) return { aggregator: name, subscribers: parseInt(match[1], 10) }
  }
  return null
}

const MOBILE_RE = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile/i

export const parseDevice = (ua) => {
  if (!ua) return 'desktop'
  return MOBILE_RE.test(ua) ? 'mobile' : 'desktop'
}

export const isBot = (path, ua = '') => {
  const lower = path.toLowerCase()
  return BOT_PREFIXES.some(prefix => lower.startsWith(prefix)) ||
    BOT_PATHS.some(pattern => lower.includes(pattern)) ||
    BOT_UAS.some(botUa => ua.toLowerCase().includes(botUa))
}

export const isDatacenter = (asn) => asn && BOT_ASNS.has(Number(asn))

export const hashIp = async (ip) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))
  return Array.from(new Uint8Array(digest)).slice(0, 8).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i

// domain gets rendered into the dashboard's nav bar - beyond the escapeHtml
// fix on the render side, rejecting anything that isn't hostname-shaped at
// ingestion means a leaked HIT_SECRET can't be used to plant something
// unexpected in the domains table in the first place.
export const isValidDomain = (domain) =>
  typeof domain === 'string' && domain.length > 0 && domain.length <= 253 && DOMAIN_RE.test(domain)

const isBoundedString = (v, maxLen) => typeof v === 'string' && v.length <= maxLen

const CLOCK_SKEW_MS = 5 * 60 * 1000

// Hits are forwarded immediately by trusted first-party Workers with
// accurate clocks, so legitimate skew should be near-zero - this bounds
// how far a caller-supplied ts can diverge from server receipt time,
// falling back rather than rejecting since a bad timestamp doesn't mean
// the rest of the hit is illegitimate.
export const sanitizeTimestamp = (ts, now = Date.now()) => {
  if (!Number.isSafeInteger(ts)) return now
  if (Math.abs(now - ts) > CLOCK_SKEW_MS) return now
  return ts
}

// Validates and bounds every /hit field before it reaches classification
// (isBot/isDatacenter) or D1 storage. Without this, a non-string path/ua
// could 500 the endpoint (isBot calls .toLowerCase() on both), and any
// field could otherwise be stored at unbounded size.
export const sanitizeHitPayload = (payload, now = Date.now()) => {
  const {
    domain, path, country, city, region, referrer, asn, ua, ip,
    rss_feed: rssFeed, ts, as_organization: asOrganization, http_protocol: httpProtocol, status
  } = payload || {}

  if (!isValidDomain(domain)) return null
  if (!isBoundedString(path, 2048) || path.length === 0) return null
  if (!isBoundedString(ip, 64) || ip.length === 0) return null

  const bounded = (v, maxLen) => (isBoundedString(v, maxLen) ? v : undefined)

  return {
    domain,
    path,
    ip,
    ts: sanitizeTimestamp(ts, now),
    country: bounded(country, 100),
    city: bounded(city, 100),
    region: bounded(region, 100),
    referrer: bounded(referrer, 2000),
    ua: bounded(ua, 1000) || '',
    asn: Number.isInteger(asn) ? asn : undefined,
    rssFeed: bounded(rssFeed, 200),
    asOrganization: bounded(asOrganization, 200),
    httpProtocol: bounded(httpProtocol, 20),
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined
  }
}

const BURST_WINDOW_MS = 15 * 1000
const BURST_DISTINCT_PATH_THRESHOLD = 4

// Returns the first 15-second window (time-sorted hit list) satisfying the
// predicate, or null. O(n^2) in the worst case but n is one IP's (or one
// ASN's) hits in the requested range, never remotely large enough to matter.
const findBurstWindow = (hits, predicate) => {
  for (let i = 0; i < hits.length; i++) {
    const windowEnd = hits[i].ts + BURST_WINDOW_MS
    const window = hits.slice(i).filter(h => h.ts <= windowEnd)
    if (predicate(window)) return window
  }
  return null
}

const hasBurstMatching = (hits, predicate) => findBurstWindow(hits, predicate) !== null

// No real human loads 4+ distinct pages in 15 seconds, regardless of what
// those requests returned - a 404 mixed into a crawl is no less suspicious
// than a 200. Reusing one path repeatedly (e.g. Rando's reroll-by-refresh,
// or a scanner hammering the same dead endpoint) is deliberately NOT
// flagged here - only breadth of distinct pages counts, so a real visitor
// refreshing is never at risk.
const distinctPathBurst = (window) => new Set(window.map(h => h.path)).size >= BURST_DISTINCT_PATH_THRESHOLD

// Symmetric to HUMAN_DETECTORS (analyticsTemplate.js) but the opposite
// polarity: evidence a visitor is a bot, not evidence they're human.
// Deliberately behavioral (needs multiple hits) rather than per-hit, which
// is why it lives here as a separate pass over grouped hits instead of
// folding into isBot/isDatacenter - you can't know it's a burst until
// you've seen several hits arrive.
export const BOT_DETECTORS = [
  {
    name: 'pathVelocity',
    test: (hits) => hasBurstMatching(hits, distinctPathBurst),
    label: () => 'rapid multi-page crawl'
  }
]

export const botSignals = (hits) => BOT_DETECTORS.filter(d => d.test(hits)).map(d => d.label())

// Same distinct-path-burst rule as pathVelocity, but pooled across every IP
// sharing an ASN - catches a scanner rotating through a pool of addresses
// on one hosting provider or residential ISP, which no single-IP detector
// can see (each IP alone might only ever send 1-2 hits). Only the IPs
// actually present in the triggering window get flagged, not the whole
// ASN's traffic for the period - an ASN can be a hosting company or ISP
// with thousands of unrelated tenants, and the 15-second window is what
// keeps this safe: several genuinely different visitors on a shared ASN
// each loading a different one of your pages within 15 seconds isn't a
// realistic coincidence at this site's traffic volume.
const asnBurstFlaggedIps = (hits) => {
  const byAsn = new Map()
  for (const hit of hits) {
    if (!hit.asn || !hit.ip_hash) continue
    if (!byAsn.has(hit.asn)) byAsn.set(hit.asn, [])
    byAsn.get(hit.asn).push(hit)
  }
  const flagged = new Set()
  for (const asnHits of byAsn.values()) {
    asnHits.sort((a, b) => a.ts - b.ts)
    const window = findBurstWindow(asnHits, distinctPathBurst)
    if (window) for (const hit of window) flagged.add(hit.ip_hash)
  }
  return flagged
}

// Flags IPs, not hits - "this visitor acted like a bot somewhere in here,"
// not "this specific hit is a bot." Callers decide what to do with that.
// Exclude RSS/feed hits before calling - feed polling is already-expected
// automated traffic, not evidence of anything.
export const getBotFlaggedIps = (hits) => {
  const byIp = new Map()
  for (const hit of hits) {
    if (!hit.ip_hash) continue
    if (!byIp.has(hit.ip_hash)) byIp.set(hit.ip_hash, [])
    byIp.get(hit.ip_hash).push(hit)
  }
  const flagged = new Set()
  for (const [ip, ipHits] of byIp) {
    ipHits.sort((a, b) => a.ts - b.ts)
    if (botSignals(ipHits).length > 0) flagged.add(ip)
  }
  for (const ip of asnBurstFlaggedIps(hits)) flagged.add(ip)
  return flagged
}

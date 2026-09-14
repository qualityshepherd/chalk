const SESSION_GAP = 30 * 60 * 1000 // 30 minutes

// Groups a flat list of hits into per-visitor sessions. On the single-day
// view ("today") sessions split on a 30-minute gap between hits from the
// same IP; on any wider view they split by calendar day instead - gap-based
// splitting across a multi-day range would otherwise chop one visitor's
// history into dozens of "sessions" a day apart, which isn't what a session
// means there.
export const groupSessions = (hits, days) => {
  const byIp = {}
  for (const hit of hits) {
    if (!byIp[hit.ip]) byIp[hit.ip] = []
    byIp[hit.ip].push(hit)
  }
  const sessions = []
  for (const ipHits of Object.values(byIp)) {
    ipHits.sort((a, b) => a.ts - b.ts)
    let session = null
    for (const hit of ipHits) {
      const sameDay = session && new Date(hit.ts).toDateString() === new Date(session.ts).toDateString()
      const withinGap = session && (hit.ts - session.lastTs <= SESSION_GAP)
      const inSession = days === 1 ? withinGap : sameDay
      if (!session || !inSession) {
        session = { ts: hit.ts, lastTs: hit.ts, ip: hit.ip, country: hit.country, region: hit.region, city: hit.city, referrer: hit.referrer || '', hits: [] }
        sessions.push(session)
      }
      session.lastTs = hit.ts
      session.hits.push({
        path: hit.path,
        ts: hit.ts,
        referrer: hit.referrer || '',
        device: hit.device || '',
        asn: hit.asn || '',
        asOrganization: hit.asOrganization || '',
        httpProtocol: hit.httpProtocol || '',
        status: hit.status
      })
    }
  }
  sessions.sort((a, b) => b.ts - a.ts)
  return sessions
}

// Merges each day's server-computed stats (from /api/analytics) into one
// period-wide summary for the currently selected date range. Days with no
// data (requested but not yet returned/populated) are skipped rather than
// crashing the whole render.
export const aggregate = (allData) => {
  let totalHits = 0
  let totalBots = 0
  const byPath = {}
  const byCountry = {}
  const byReferrer = {}
  const byRss = {}
  const byDevice = { mobile: 0, desktop: 0 }
  const byHour = Array(24).fill(0)
  const byDow = Array(7).fill(0)
  const recentHits = []
  for (const { data } of allData) {
    if (!data) continue
    totalHits += data.totalHits || 0
    totalBots += data.bots || 0
    for (const [k, v] of Object.entries(data.byPath || {})) byPath[k] = (byPath[k] || 0) + v
    for (const [k, v] of Object.entries(data.byCountry || {})) byCountry[k] = (byCountry[k] || 0) + v
    for (const [k, v] of Object.entries(data.byReferrer || {})) byReferrer[k] = (byReferrer[k] || 0) + v
    for (const [feed, v] of Object.entries(data.byRss || {})) {
      if (!byRss[feed]) byRss[feed] = { hits: 0, subscribers: 0, aggregators: {} }
      byRss[feed].hits += v.hits || 0
      byRss[feed].subscribers = Math.max(byRss[feed].subscribers, v.subscribers || 0)
      for (const [agg, count] of Object.entries(v.aggregators || {})) byRss[feed].aggregators[agg] = (byRss[feed].aggregators[agg] || 0) + count
    }
    byDevice.mobile += data.byDevice?.mobile || 0
    byDevice.desktop += data.byDevice?.desktop || 0
    ;(data.byHour || []).forEach((count, i) => { byHour[i] += count })
    ;(data.byDow || []).forEach((count, i) => { byDow[i] += count })
    recentHits.push(...(data.recentHits || []))
  }
  recentHits.sort((a, b) => b.ts - a.ts)
  return { totalHits, totalBots, byPath, byCountry, byReferrer, byRss, byDevice, byHour, byDow, recentHits }
}

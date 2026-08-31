export default `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>analytics</title>
<link rel="icon" href="/favicon.png" />
<link rel="stylesheet" href="/analytics.css">
</head>
<body>
<div class="wrap">
  <p class="title">analytics</p>
  <p class="subtitle" id="hostname"></p>
  <nav class="days-nav" id="domain-nav"></nav>
  <nav class="days-nav" id="nav"></nav>
  <div class="summary" id="summary"></div>
  <div class="maps" id="maps"></div>
  <div id="charts"></div>
  <div id="filter-bar" class="filter-bar"></div>
  <div id="logs"></div>
</div>
<script>
const params = new URLSearchParams(location.search)
const days = parseInt(params.get('days') || '1')
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const SESSION_GAP = 30 * 60 * 1000 // 30 minutes

const COUNTRY_NAMES = {
  AF:'Afghanistan',AL:'Albania',DZ:'Algeria',AO:'Angola',AR:'Argentina',AM:'Armenia',AU:'Australia',AT:'Austria',
  AZ:'Azerbaijan',BH:'Bahrain',BD:'Bangladesh',BY:'Belarus',BE:'Belgium',BO:'Bolivia',BA:'Bosnia',BR:'Brazil',
  BG:'Bulgaria',KH:'Cambodia',CM:'Cameroon',CA:'Canada',CL:'Chile',CN:'China',CO:'Colombia',CD:'Congo',
  CR:'Costa Rica',HR:'Croatia',CU:'Cuba',CY:'Cyprus',CZ:'Czech Republic',DK:'Denmark',DO:'Dominican Republic',
  EC:'Ecuador',EG:'Egypt',SV:'El Salvador',EE:'Estonia',ET:'Ethiopia',FI:'Finland',FR:'France',
  GE:'Georgia',DE:'Germany',GH:'Ghana',GR:'Greece',GT:'Guatemala',HN:'Honduras',HK:'Hong Kong',
  HU:'Hungary',IS:'Iceland',IN:'India',ID:'Indonesia',IQ:'Iraq',IE:'Ireland',IL:'Israel',IT:'Italy',
  JM:'Jamaica',JP:'Japan',JO:'Jordan',KZ:'Kazakhstan',KE:'Kenya',KR:'South Korea',KW:'Kuwait',
  LV:'Latvia',LB:'Lebanon',LY:'Libya',LT:'Lithuania',LU:'Luxembourg',MK:'North Macedonia',
  MY:'Malaysia',MX:'Mexico',MD:'Moldova',MN:'Mongolia',MA:'Morocco',MZ:'Mozambique',MM:'Myanmar',
  NP:'Nepal',NL:'Netherlands',NZ:'New Zealand',NI:'Nicaragua',NG:'Nigeria',NO:'Norway',
  OM:'Oman',PK:'Pakistan',PA:'Panama',PY:'Paraguay',PE:'Peru',PH:'Philippines',PL:'Poland',
  PT:'Portugal',QA:'Qatar',RO:'Romania',RU:'Russia',SA:'Saudi Arabia',SN:'Senegal',RS:'Serbia',
  SG:'Singapore',SK:'Slovakia',SI:'Slovenia',ZA:'South Africa',ES:'Spain',LK:'Sri Lanka',
  SD:'Sudan',SE:'Sweden',CH:'Switzerland',SY:'Syria',TW:'Taiwan',TJ:'Tajikistan',TZ:'Tanzania',
  TH:'Thailand',TN:'Tunisia',TR:'Turkey',TM:'Turkmenistan',UG:'Uganda',UA:'Ukraine',
  AE:'United Arab Emirates',GB:'United Kingdom',US:'United States',UY:'Uruguay',
  UZ:'Uzbekistan',VE:'Venezuela',VN:'Vietnam',YE:'Yemen',ZM:'Zambia',ZW:'Zimbabwe'
}

const countryName = code => COUNTRY_NAMES[code] || code

// A hit's referrer is attacker/visitor-controlled input, not guaranteed to be
// a valid URL - every callsite that reads its hostname needs this guard.
const safeHostname = (url) => { try { return new URL(url).hostname } catch { return '' } }

// path/city/referrer ultimately trace back to a visitor's request (the URL
// they typed, their Referer header) - anything from a hit record that lands
// in innerHTML has to go through this first, or a crafted path is stored
// XSS against whoever's logged into the dashboard.
const escapeHtml = (str) => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

// Region-code data is inconsistent upstream ('?' shows up as a real value,
// not just missing) - centralize the "is this actually usable" check here
// instead of repeating the same '&& region !== "?"' at every callsite.
const locationTooltip = (city, region, countryCode) =>
  [city, region && region !== '?' ? region : null, countryName(countryCode)].filter(Boolean).join(', ')

document.getElementById('hostname').textContent = location.hostname

const renderDaysNav = (domain) => {
  document.getElementById('nav').innerHTML = [1, 2, 7, 30, 365].map(dayCount => {
    const label = dayCount === 1 ? 'today' : dayCount === 2 ? '2d' : dayCount === 7 ? 'week' : dayCount === 30 ? '30d' : 'year'
    return \`<a href="?days=\${dayCount}&domain=\${encodeURIComponent(domain)}"\${days === dayCount ? ' class="active"' : ''}>\${label}</a>\`
  }).join('')
}

const renderDomainNav = (domains, active) => {
  document.getElementById('domain-nav').innerHTML = domains.map(domain =>
    \`<a href="?days=\${days}&domain=\${encodeURIComponent(domain)}"\${domain === active ? ' class="active"' : ''}>\${domain}</a>\`
  ).join('')
}

// ISO country code -> flag emoji works by offsetting each letter into the
// Unicode "regional indicator symbol" range - same trick, three call shapes.
const flagEmoji = (code) => {
  if (!code || code === '?') return ''
  return code.toUpperCase().replace(/./g, char => String.fromCodePoint(0x1F1E6 + char.charCodeAt(0) - 65))
}

const flag = (code) => {
  const emoji = flagEmoji(code)
  return emoji ? \`<span title="\${countryName(code)}">\${emoji}</span> \` : ''
}

const flagWithRegion = (code, region) => {
  const emoji = flagEmoji(code)
  return emoji ? \`<span title="\${locationTooltip(null, region, code)}">\${emoji}</span>\` : ''
}

const formatNum = (n) => {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\\.0$/, '') + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\\.0$/, '') + 'k'
  return String(n)
}

const statClass = (n) => n >= 1e3 ? ' long' : ''

const fmtTs = (ts) => {
  const dateObj = new Date(ts)
  const date = days > 1 ? dateObj.toLocaleDateString('en', { month: 'short', day: 'numeric' }) + ' · ' : ''
  return date + dateObj.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })
}

const bars = (items, isCountry = false) => items.map(([name, count]) => {
  const label = isCountry ? \`\${flag(name)}\${escapeHtml(countryName(name))}\` : escapeHtml(name)
  const title = isCountry ? escapeHtml(countryName(name)) : escapeHtml(name)
  return \`<div class="bar-wrap" title="\${title}">\` +
    \`<span class="label">\${label}</span>\` +
    \`<div class="bar" style="width:\${Math.round(count / (items[0]?.[1] || 1) * 120)}px"></div>\` +
    \`<span class="count">\${count}</span></div>\`
}).join('')

const heatmap = (data, labels, cls) => {
  const max = Math.max(...data, 1)
  const cells = data.map((count, i) => {
    const opacity = count === 0 ? 0.05 : (0.15 + (count / max) * 0.85).toFixed(2)
    return \`<div class="heatmap-cell" style="opacity:\${opacity}" title="\${labels[i]}: \${count}"></div>\`
  }).join('')
  return \`<div class="heatmap \${cls}">\${cells}</div>\` +
    \`<div class="heatmap-labels \${cls}">\${labels.map(label => \`<span>\${label}</span>\`).join('')}</div>\`
}

const groupSessions = (hits) => {
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
        session = { ts: hit.ts, lastTs: hit.ts, ip: hit.ip, country: hit.country, region: hit.region, city: hit.city, referrer: hit.referrer || '', paths: [], pathTs: [], pathRefs: [] }
        sessions.push(session)
      }
      session.lastTs = hit.ts
      session.paths.push(hit.path)
      session.pathTs.push(hit.ts)
      session.pathRefs.push(hit.referrer || '')
    }
  }
  sessions.sort((a, b) => b.ts - a.ts)
  return sessions
}

const aggregate = (allData) => {
  let totalHits = 0, totalBots = 0, totalUniques = 0
  const byPath = {}, byCountry = {}, byReferrer = {}, byRss = {}, byDevice = { mobile: 0, desktop: 0 }
  const byHour = Array(24).fill(0), byDow = Array(7).fill(0)
  const recentHits = []
  for (const { data } of allData) {
    if (!data) continue
    totalHits += data.totalHits || 0
    totalBots += data.bots || 0
    const uniques = data.uniques
    totalUniques += Array.isArray(uniques) ? uniques.length : (typeof uniques === 'number' ? uniques : 0)
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
  return { totalHits, totalBots, totalUniques, byPath, byCountry, byReferrer, byRss, byDevice, byHour, byDow, recentHits }
}

let activeIp = null
let allSessions = []

const renderLogs = () => {
  const filterBar = document.getElementById('filter-bar')

  if (activeIp) {
    const sessions = allSessions.filter(session => session.ip === activeIp)
    const session = sessions[0]
    const ref = session && session.referrer ? escapeHtml(safeHostname(session.referrer)) : ''
    filterBar.innerHTML = session ? \`<span onclick="clearFilter()" style="cursor:pointer">\${flagWithRegion(session.country, session.region)} \${escapeHtml(session.city || '?')}\${ref ? \` · \${ref}\` : ''} <a>✕ clear</a></span>\` : ''
    const html = sessions.flatMap(session =>
      session.paths.map((path, j) => {
        const refHost = session.pathRefs && session.pathRefs[j] ? escapeHtml(safeHostname(session.pathRefs[j])) : ''
        const locTipF = escapeHtml(locationTooltip(session.city, session.region, session.country))
      return \`<div class="session-header" onclick="clearFilter()" style="cursor:pointer">\` +
        \`<span class="log-ts" title="\${escapeHtml(session.ip || '')}">\${fmtTs(session.pathTs ? session.pathTs[j] : session.ts)}</span>\` +
        \`<span class="log-city" title="\${locTipF}">\${session.country ? \`<a href="https://maps.google.com/?q=\${encodeURIComponent(locTipF)}" target="_blank" onclick="event.stopPropagation()">\${flagEmoji(session.country)}</a> \` : ''}\${escapeHtml(session.city || '?')}</span>\` +
        \`<span class="log-path" title="\${escapeHtml(path)}">\${escapeHtml(path)}</span>\` +
        \`<span class="log-ref">\${refHost}</span>\` +
        \`</div>\`
      })
    ).join('')
    document.getElementById('logs').innerHTML = html ? \`<h2>recent hits</h2>\${html}\` : ''
    return
  }

  filterBar.innerHTML = ''
  const html = allSessions.slice(0, 999).map(session => {
    const count = session.paths.length
    const firstPath = session.paths[0] || ''
    const firstRef = session.pathRefs && session.pathRefs[0] ? escapeHtml(safeHostname(session.pathRefs[0])) : ''
    const locTip = escapeHtml(locationTooltip(session.city, session.region, session.country))
    return \`<div class="session-header">\` +
      \`<span class="log-ts" title="\${escapeHtml(session.ip || '')}">\${fmtTs(session.ts)}</span>\` +
      \`<span class="log-city\${count > 1 ? ' active' : ''}" \${count > 1 ? \`onclick="filterIp('\${session.ip}')"\` : ''} style="\${count > 1 ? 'cursor:pointer' : ''}" title="\${locTip}">\${session.country ? \`<a href="https://maps.google.com/?q=\${encodeURIComponent(locTip)}" target="_blank" onclick="event.stopPropagation()">\${flagEmoji(session.country)}</a> \` : ''}\${escapeHtml(session.city || '?')}\${count > 1 ? \` (\${count})\` : ''}</span>\` +
      \`<span class="log-path" title="\${escapeHtml(firstPath)}">\${escapeHtml(firstPath)}</span>\` +
      \`<span class="log-ref">\${firstRef}</span>\` +
      \`</div>\`
  }).join('')
  document.getElementById('logs').innerHTML = html ? \`<h2>recent hits</h2>\${html}\` : ''
}

window.filterIp = (ip) => { activeIp = ip; renderLogs() }
window.clearFilter = () => { activeIp = null; renderLogs() }

const render = (allData) => {
  const stats = aggregate(allData)
  allSessions = groupSessions(stats.recentHits)
  const topPaths = Object.entries(stats.byPath).sort((a, b) => b[1] - a[1]).slice(0, 10)
  const topCountries = Object.entries(stats.byCountry).sort((a, b) => b[1] - a[1]).slice(0, 10)
  const topRefs = Object.entries(stats.byReferrer).sort((a, b) => b[1] - a[1]).slice(0, 10)

  const hourLabels = Array.from({length: 24}, (_, i) => i === 0 ? '12a' : i < 12 ? \`\${i}a\` : i === 12 ? '12p' : \`\${i-12}p\`)

  const rssFeeds = Object.entries(stats.byRss).sort((a, b) => (b[1].hits || 0) - (a[1].hits || 0))
  const totalRssHits = rssFeeds.reduce((sum, [, v]) => sum + (v.hits || 0), 0)
  const rssTip = rssFeeds.length
    ? rssFeeds.map(([feed, v]) => {
        const subInfo = v.subscribers > 0 ? \` · \${v.subscribers} subs\` : ''
        const aggs = Object.keys(v.aggregators).join(', ')
        return \`<div class="tip-row"><span>📡 \${feed}\${subInfo}\${aggs ? \` · \${aggs}\` : ''}</span><strong>\${v.hits || 0}</strong></div>\`
      }).join('')
    : \`<div class="tip-row"><span>no rss hits yet</span></div>\`

  const totalDevices = stats.byDevice.mobile + stats.byDevice.desktop
  const mobilePct = totalDevices > 0 ? Math.round((stats.byDevice.mobile / totalDevices) * 100) : null

  document.getElementById('summary').innerHTML =
    \`<div><strong class="\${statClass(stats.totalHits)}" title="\${stats.totalHits}">\${formatNum(stats.totalHits)}</strong><span>hits</span></div>\` +
    \`<div><strong class="\${statClass(stats.totalUniques)}" title="\${stats.totalUniques}">\${formatNum(stats.totalUniques)}</strong><span>unique</span></div>\` +
    \`<div><strong>\${allData.length}</strong><span>days</span></div>\` +
    \`<div><strong class="\${statClass(stats.totalBots)}" title="\${stats.totalBots}">\${formatNum(stats.totalBots)}</strong><span>🤖 bots</span></div>\` +
    (mobilePct !== null ? \`<div><strong>\${mobilePct}%</strong><span>📱 mobile</span></div>\` : '') +
    (totalRssHits > 0 ? \`<div class="has-tip"><strong class="\${statClass(totalRssHits)}" title="\${totalRssHits}">\${formatNum(totalRssHits)}</strong><span>📡 rss</span><div class="tip">\${rssTip}</div></div>\` : '')

  document.getElementById('maps').innerHTML =
    \`<div>\${heatmap(stats.byDow, DOW, 'dow')}</div>\` +
    \`<div>\${heatmap(stats.byHour, hourLabels, 'hour')}</div>\`

  document.getElementById('charts').innerHTML =
    \`<div class="charts-grid">\` +
      \`<div><h2>top paths</h2><div>\${bars(topPaths)}</div></div>\` +
      \`<div><h2>top countries</h2><div>\${bars(topCountries, true)}</div></div>\` +
    \`</div>\` +
    \`<h2>top referrers</h2><div>\${bars(topRefs)}</div>\`

  renderLogs()
}

const fetchJson = (url) => fetch(url, { credentials: 'same-origin' }).then(response => {
  if (response.status === 401) { location.href = '/login'; throw new Error('unauthorized') }
  if (!response.ok) throw new Error(\`\${response.status}\`)
  return response.json()
})

fetchJson('/api/analytics')
  .then(({ domains }) => {
    if (!domains || !domains.length) {
      document.getElementById('summary').textContent = 'no data yet'
      return
    }
    const requested = params.get('domain')
    const domain = requested && domains.includes(requested) ? requested : domains[0]
    renderDomainNav(domains, domain)
    renderDaysNav(domain)
    return fetchJson(\`/api/analytics?domain=\${encodeURIComponent(domain)}&days=\${days}\`).then(render)
  })
  .catch(err => {
    if (err.message !== 'unauthorized') document.getElementById('summary').textContent = 'failed to load'
  })
</script>
</body>
</html>
`

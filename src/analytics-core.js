// filters because BOTS ARE FUCKING FUN...

const BOT_PREFIXES = [
  '/account/', '/api/v1', '/back/', '/bak/', '/billing/', '/cgi-bin/', '/checkout',
  '/conf.d/', '/donate', '/error/', '/etc/', '/file-upload', '/fileupload',
  '/files/', '/form/', '/import/', '/info', '/ip', '/log/', '/login',
  '/mcp', '/officialsite', '/old/', '/opt/', '/order/', '/php-cgi', '/phpinfo', '/plans/',
  '/proc/', '/register', '/rest/', '/restore/', '/root/', '/shop/', '/sse',
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
  'meta-inf', 'metadata/', 'package.json',
  'passwd', 'pom.properties', 'requirements.txt',
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

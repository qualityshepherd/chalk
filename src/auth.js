export const timingSafeEqual = (a, b) => {
  const te = new TextEncoder()
  const ab = te.encode(a)
  const bb = te.encode(b)
  if (ab.length !== bb.length) return false
  if (ab.length === 0) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}

export const isAuthorizedPubkey = (pubkey, env) => {
  if (!pubkey || !env.AUTH_PUBKEY) return false
  const candidates = env.AUTH_PUBKEY.split(',').map((key) => key.trim()).filter(Boolean)
  return candidates.some((candidate) => timingSafeEqual(pubkey.trim(), candidate))
}

export const isRateLimited = (record, now, maxAttempts) =>
  !!record && now < record.resetAt && record.count >= maxAttempts

export const incrementAttempt = (record, now, windowMs) => {
  if (!record || now >= record.resetAt) return { count: 1, resetAt: now + windowMs }
  return { count: record.count + 1, resetAt: record.resetAt }
}

export const NONCE_TTL_MS = 5 * 60 * 1000
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000
export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 6
export const LOGIN_RATE_LIMIT_WINDOW_MS = 12 * 60 * 1000

export function generateNonce () {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function generateSessionToken () {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function isNonceExpired (createdAt, now) { return now - createdAt > NONCE_TTL_MS }
export function isSessionExpired (createdAt, now) { return now - createdAt > SESSION_TTL_MS }

export async function hashToken (token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes (hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export async function verifySignature (nonceHex, sigHex, publicKeyBytes) {
  try {
    const key = await crypto.subtle.importKey('raw', publicKeyBytes, { name: 'Ed25519' }, false, ['verify'])
    const message = new TextEncoder().encode(nonceHex)
    const signature = hexToBytes(sigHex)
    return await crypto.subtle.verify('Ed25519', key, signature, message)
  } catch {
    return false
  }
}

export function sessionCookie (token, name, maxAgeSeconds) {
  return `${name}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`
}

export function clearedSessionCookie (name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
}

export function parseCookies (cookieHeader) {
  const cookies = {}
  if (!cookieHeader) return cookies
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
  }
  return cookies
}

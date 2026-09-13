import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  timingSafeEqual, isAuthorizedPubkey, isRateLimited,
  generateNonce, generateSessionToken, isNonceExpired, isSessionExpired,
  hexToBytes, sessionCookie, clearedSessionCookie, parseCookies,
  hashToken, verifySignature, NONCE_TTL_MS, SESSION_TTL_MS
} from '../src/auth.js'

async function generateEd25519KeyPair () {
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  return { privateKey: keyPair.privateKey, publicKeyBytes: rawPublicKey }
}

async function signHex (privateKey, message) {
  const sig = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

test('isAuthorizedPubkey: matching pubkey returns true', () => {
  assert.equal(isAuthorizedPubkey('abc123', { AUTH_PUBKEY: 'abc123' }), true)
})

test('isAuthorizedPubkey: trims whitespace', () => {
  assert.equal(isAuthorizedPubkey('abc123', { AUTH_PUBKEY: '  abc123  ' }), true)
})

test('isAuthorizedPubkey: matches second key in comma-separated list', () => {
  assert.equal(isAuthorizedPubkey('key2', { AUTH_PUBKEY: 'key1,key2,key3' }), true)
})

test('isAuthorizedPubkey: mismatched pubkey returns false', () => {
  assert.equal(isAuthorizedPubkey('abc123', { AUTH_PUBKEY: 'xyz' }), false)
})

test('isAuthorizedPubkey: missing pubkey returns false', () => {
  assert.equal(isAuthorizedPubkey(null, { AUTH_PUBKEY: 'abc123' }), false)
  assert.equal(isAuthorizedPubkey('', { AUTH_PUBKEY: 'abc123' }), false)
})

test('isAuthorizedPubkey: missing env.AUTH_PUBKEY returns false', () => {
  assert.equal(isAuthorizedPubkey('abc123', {}), false)
  assert.equal(isAuthorizedPubkey('abc123', { AUTH_PUBKEY: '' }), false)
})

test('timingSafeEqual: equal strings return true', () => {
  assert.equal(timingSafeEqual('hello', 'hello'), true)
})

test('timingSafeEqual: different strings return false', () => {
  assert.equal(timingSafeEqual('hello', 'world'), false)
})

test('timingSafeEqual: different lengths return false', () => {
  assert.equal(timingSafeEqual('abc', 'abcd'), false)
})

test('timingSafeEqual: empty strings return false', () => {
  assert.equal(timingSafeEqual('', ''), false)
})

test('isRateLimited: null record is not limited', () => {
  assert.equal(isRateLimited(null, Date.now(), 6), false)
})

test('isRateLimited: under max attempts is not limited', () => {
  assert.equal(isRateLimited({ count: 3, resetAt: Date.now() + 10000 }, Date.now(), 6), false)
})

test('isRateLimited: at max attempts is limited', () => {
  assert.equal(isRateLimited({ count: 6, resetAt: Date.now() + 10000 }, Date.now(), 6), true)
})

test('isRateLimited: expired window is not limited even at max', () => {
  assert.equal(isRateLimited({ count: 6, resetAt: Date.now() - 1 }, Date.now(), 6), false)
})

test('generateNonce: returns 32 hex chars', () => {
  const nonce = generateNonce()
  assert.equal(nonce.length, 32)
  assert.match(nonce, /^[0-9a-f]+$/)
})

test('generateNonce: returns different values each call', () => {
  assert.notEqual(generateNonce(), generateNonce())
})

test('generateSessionToken: returns 64 hex chars', () => {
  const token = generateSessionToken()
  assert.equal(token.length, 64)
  assert.match(token, /^[0-9a-f]+$/)
})

test('isNonceExpired: fresh nonce is not expired', () => {
  assert.equal(isNonceExpired(Date.now(), Date.now()), false)
})

test('isNonceExpired: nonce older than TTL is expired', () => {
  const now = Date.now()
  assert.equal(isNonceExpired(now - NONCE_TTL_MS - 1, now), true)
})

test('isSessionExpired: fresh session is not expired', () => {
  assert.equal(isSessionExpired(Date.now(), Date.now()), false)
})

test('isSessionExpired: session older than TTL is expired', () => {
  const now = Date.now()
  assert.equal(isSessionExpired(now - SESSION_TTL_MS - 1, now), true)
})

test('hexToBytes: converts hex string to byte array', () => {
  const bytes = hexToBytes('deadbeef')
  assert.deepEqual(Array.from(bytes), [0xde, 0xad, 0xbe, 0xef])
})

test('sessionCookie: includes HttpOnly, Secure, SameSite=Lax', () => {
  const cookie = sessionCookie('abc123', 'chalk_session', 86400)
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /Secure/)
  assert.match(cookie, /SameSite=Lax/)
  assert.match(cookie, /chalk_session=abc123/)
})

test('clearedSessionCookie: sets Max-Age=0', () => {
  assert.match(clearedSessionCookie('chalk_session'), /Max-Age=0/)
})

test('parseCookies: parses multiple cookies', () => {
  const parsed = parseCookies('chalk_session=abc123; other=xyz')
  assert.equal(parsed.chalk_session, 'abc123')
  assert.equal(parsed.other, 'xyz')
})

test('parseCookies: handles empty/missing header', () => {
  assert.deepEqual(parseCookies(null), {})
  assert.deepEqual(parseCookies(''), {})
})

test('hashToken: returns 64-char hex SHA-256', async () => {
  const h = await hashToken('sometoken')
  assert.equal(h.length, 64)
  assert.match(h, /^[0-9a-f]+$/)
})

test('hashToken: same input yields same hash', async () => {
  assert.equal(await hashToken('abc'), await hashToken('abc'))
})

test('hashToken: different inputs yield different hashes', async () => {
  assert.notEqual(await hashToken('abc'), await hashToken('xyz'))
})

// verifySignature - the actual gate on /api/login. Real Ed25519 keys, no
// mocks: generate a keypair, sign a challenge, and check the function
// accepts what it should and rejects everything else.
test('verifySignature: valid signature over the exact challenge verifies', async () => {
  const { privateKey, publicKeyBytes } = await generateEd25519KeyPair()
  const challenge = generateNonce()
  const sig = await signHex(privateKey, challenge)
  assert.equal(await verifySignature(challenge, sig, publicKeyBytes), true)
})

test('verifySignature: signature over a different message fails', async () => {
  const { privateKey, publicKeyBytes } = await generateEd25519KeyPair()
  const sig = await signHex(privateKey, 'some-other-challenge')
  assert.equal(await verifySignature('the-real-challenge', sig, publicKeyBytes), false)
})

test('verifySignature: valid signature checked against the wrong public key fails', async () => {
  const signer = await generateEd25519KeyPair()
  const impostor = await generateEd25519KeyPair()
  const challenge = generateNonce()
  const sig = await signHex(signer.privateKey, challenge)
  assert.equal(await verifySignature(challenge, sig, impostor.publicKeyBytes), false)
})

test('verifySignature: tampering with one byte of a valid signature fails', async () => {
  const { privateKey, publicKeyBytes } = await generateEd25519KeyPair()
  const challenge = generateNonce()
  const sigBytes = hexToBytes(await signHex(privateKey, challenge))
  sigBytes[0] ^= 0xff
  const tamperedHex = Array.from(sigBytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  assert.equal(await verifySignature(challenge, tamperedHex, publicKeyBytes), false)
})

test('verifySignature: malformed signature hex does not throw, just fails', async () => {
  const { publicKeyBytes } = await generateEd25519KeyPair()
  assert.equal(await verifySignature('challenge', 'not-valid-hex!!', publicKeyBytes), false)
})

test('verifySignature: malformed public key bytes does not throw, just fails', async () => {
  const { privateKey } = await generateEd25519KeyPair()
  const challenge = generateNonce()
  const sig = await signHex(privateKey, challenge)
  assert.equal(await verifySignature(challenge, sig, new Uint8Array(4)), false)
})

/* global self */
const PKCS8_HEADER = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20
])

function bytesToHex (bytes) {
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function base64UrlToBytes (b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deriveKeyPair (passphrase, hostname) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']
  )
  const seed = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(hostname), iterations: 600000 },
    keyMaterial, 256
  )
  const pkcs8 = new Uint8Array(PKCS8_HEADER.length + 32)
  pkcs8.set(PKCS8_HEADER)
  pkcs8.set(new Uint8Array(seed), PKCS8_HEADER.length)
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']
  )
  const jwk = await crypto.subtle.exportKey('jwk', privateKey)
  const pubKeyHex = bytesToHex(base64UrlToBytes(jwk.x))
  return { privateKey, pubKeyHex }
}

self.addEventListener('message', async (e) => {
  const { passphrase, hostname, challenge } = e.data
  try {
    const { privateKey, pubKeyHex } = await deriveKeyPair(passphrase, hostname)
    let sigHex = null
    if (challenge) {
      const sig = new Uint8Array(
        await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(challenge))
      )
      sigHex = bytesToHex(sig)
    }
    self.postMessage({ pubKeyHex, sigHex })
  } catch (err) {
    self.postMessage({ error: err.message })
  }
})

/**
 * Envelope encryption for transcripts and provider credentials.
 *
 * A per-workspace data key, wrapped by a master key that lives only in Worker
 * secrets. R2 holds ciphertext; D1 holds pointers. Nothing readable is stored,
 * and deleting a workspace's wrapped key makes every object it ever wrote
 * permanently unreadable — which is what "delete means delete" has to mean when
 * object stores are eventually consistent.
 *
 * Ported from callcraft's src/crypto/envelope.ts, whose posture was right.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

export function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function unb64(s: string): Uint8Array {
  const raw = atob(s)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function masterKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error('master_key_missing')
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(secret))
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export type Envelope = {
  v: 1
  /** The data key, encrypted with the master key. */
  wrappedKey: string
  keyIv: string
  iv: string
  ct: string
}

async function freshDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

function iv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12))
}

export async function seal(plaintext: string, secret: string): Promise<Envelope> {
  const master = await masterKey(secret)
  const dataKey = await freshDataKey()

  const dataIv = iv()
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: dataIv as BufferSource },
    dataKey,
    enc.encode(plaintext),
  )

  const rawDataKey = await crypto.subtle.exportKey('raw', dataKey)
  const keyIv = iv()
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: keyIv as BufferSource },
    master,
    rawDataKey,
  )

  return { v: 1, wrappedKey: b64(wrapped), keyIv: b64(keyIv), iv: b64(dataIv), ct: b64(ct) }
}

export async function open(envelope: Envelope, secret: string): Promise<string> {
  const master = await masterKey(secret)

  const rawDataKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(envelope.keyIv) as BufferSource },
    master,
    unb64(envelope.wrappedKey) as BufferSource,
  )
  const dataKey = await crypto.subtle.importKey('raw', rawDataKey, { name: 'AES-GCM' }, false, ['decrypt'])

  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(envelope.iv) as BufferSource },
    dataKey,
    unb64(envelope.ct) as BufferSource,
  )

  return dec.decode(plain)
}

/**
 * Browser workspace identity.
 *
 * Local development and the isolated test worker deliberately keep the old
 * `solo` identity. A deployed worker with TALLTRACK_ACCESS_TOKEN set instead
 * requires a signed, HttpOnly session cookie before it can touch workspace
 * data. The cookie contains no access code, and the workspace id never comes
 * from a request body or query parameter.
 */

export const SOLO_WORKSPACE = 'solo'
export const SESSION_COOKIE = 'tt_session'
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

type AuthEnv = Pick<Cloudflare.Env, 'TALLTRACK_ACCESS_TOKEN'>

export class AuthRequiredError extends Error {
  constructor() {
    super('Sign in to TallTrack to continue.')
    this.name = 'AuthRequiredError'
  }
}

const encoder = new TextEncoder()

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function keyFor(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

async function sign(secret: string, payload: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(payload))
  return base64url(new Uint8Array(signature))
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let i = 0; i < left.length; i++) difference |= left[i]! ^ right[i]!
  return difference === 0
}

function cookieValue(request: Request): string | null {
  const header = request.headers.get('cookie') ?? ''
  const item = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))
  return item ? item.slice(SESSION_COOKIE.length + 1) : null
}

async function sessionValid(request: Request, env: AuthEnv): Promise<boolean> {
  const secret = env.TALLTRACK_ACCESS_TOKEN
  if (!secret) return true

  const raw = cookieValue(request)
  if (!raw) return false
  const [payload, provided] = raw.split('.')
  if (!payload || !provided) return false

  let expected: Uint8Array
  try {
    expected = fromBase64url(await sign(secret, payload))
  } catch {
    return false
  }

  let actual: Uint8Array
  try {
    actual = fromBase64url(provided)
  } catch {
    return false
  }
  if (!constantTimeEqual(expected, actual)) return false

  try {
    const decoded = new TextDecoder().decode(fromBase64url(payload)).split('.')
    const workspace = decoded[0]
    const expiry = Number(decoded[1])
    return workspace === SOLO_WORKSPACE && Number.isSafeInteger(expiry) && expiry > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

export async function isBrowserAuthenticated(request: Request, env: AuthEnv): Promise<boolean> {
  return sessionValid(request, env)
}

export async function workspaceOf(request: Request, env: AuthEnv): Promise<string> {
  if (!(await sessionValid(request, env))) throw new AuthRequiredError()
  return SOLO_WORKSPACE
}

export async function issueSessionCookie(env: AuthEnv): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const payload = base64url(encoder.encode(`${SOLO_WORKSPACE}.${expiry}.${crypto.randomUUID()}`))
  const signature = await sign(env.TALLTRACK_ACCESS_TOKEN ?? '', payload)
  return `${SESSION_COOKIE}=${payload}.${signature}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax; Secure`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`
}

export async function accessCodeMatches(env: AuthEnv, candidate: unknown): Promise<boolean> {
  const secret = env.TALLTRACK_ACCESS_TOKEN
  if (!secret || typeof candidate !== 'string') return false
  const left = encoder.encode(secret)
  const right = encoder.encode(candidate)
  return constantTimeEqual(left, right)
}

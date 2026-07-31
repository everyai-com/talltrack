/**
 * Sign in with Claude — PKCE against the Claude Code public client.
 *
 * One click opens Anthropic's approval page in a new tab. The person approves,
 * Anthropic shows them a short one-time code, they paste it back, and the
 * exchange happens server-side. The result is the same subscription credential
 * `claude setup-token` produces, obtained without a terminal and without
 * driving the CLI inside a container.
 *
 * Ported from callcraft's src/llm/engine.ts, which runs this in production.
 *
 * The verifier NEVER leaves the Worker. It is held in KV against an opaque id
 * and the browser only ever sees that id — a verifier that reaches the browser
 * turns PKCE back into a bare redirect anyone can replay.
 */

export const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
export const CLAUDE_REDIRECT = 'https://console.anthropic.com/oauth/code/callback'
export const CLAUDE_SCOPE = 'org:create_api_key user:profile user:inference'
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'

/** Long enough to sign in and approve without rushing; short enough to expire. */
export const AUTH_TTL_SECONDS = 10 * 60

export class OAuthError extends Error {}

function urlSafe(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function randomUrlSafe(bytes: number): string {
  return urlSafe(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return urlSafe(new Uint8Array(digest))
}

/** Compare without leaking where two strings first differ. */
function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return diff === 0
}

export type PendingAuth = { verifier: string; state: string; startedAt: number }
export type AuthStart = { authId: string; authorizeUrl: string; pending: PendingAuth }

export async function startClaudeAuth(): Promise<AuthStart> {
  const verifier = randomUrlSafe(64)
  const state = randomUrlSafe(32)

  const params = new URLSearchParams({
    // `code=true` is what makes Anthropic display the code instead of
    // redirecting — the reason this works without us hosting a callback.
    code: 'true',
    client_id: CLAUDE_CLIENT_ID,
    response_type: 'code',
    redirect_uri: CLAUDE_REDIRECT,
    scope: CLAUDE_SCOPE,
    code_challenge: await s256(verifier),
    code_challenge_method: 'S256',
    state,
  })

  return {
    authId: `cauth-${randomUrlSafe(16)}`,
    authorizeUrl: `https://claude.ai/oauth/authorize?${params}`,
    pending: { verifier, state, startedAt: Date.now() },
  }
}

export type ClaudeTokens = {
  accessToken: string
  refreshToken?: string
  /** Epoch ms, already backed off by a safety margin. */
  expiresAt?: number
}

/** expires_in when given, else the JWT's own exp. Five minutes of margin either way. */
function expiryFrom(expiresIn: number | undefined, token: string): number | undefined {
  const margin = 5 * 60 * 1000
  if (expiresIn) return Date.now() + expiresIn * 1000 - margin
  try {
    const payload = token.split('.')[1]
    if (!payload) return undefined
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
    return typeof claims.exp === 'number' ? claims.exp * 1000 - margin : undefined
  } catch {
    return undefined
  }
}

/**
 * Anthropic shows the code as `code#state`. People paste it with stray spaces
 * and the odd trailing newline; that is not a user error, so trim generously
 * and validate strictly.
 */
export async function finishClaudeAuth(pasted: string, pending: PendingAuth): Promise<ClaudeTokens> {
  const [code, state] = pasted.trim().split('#')

  if (!code) throw new OAuthError('That code looks incomplete. Copy the whole thing from the Claude tab.')
  if (!state || !constantTimeEqual(state, pending.state))
    throw new OAuthError('That code was from a different sign-in. Start again and use the newest tab.')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      state,
      client_id: CLAUDE_CLIENT_ID,
      redirect_uri: CLAUDE_REDIRECT,
      code_verifier: pending.verifier,
    }),
  })

  if (!res.ok)
    throw new OAuthError(
      res.status === 400
        ? 'Claude rejected that code. They only work once and expire quickly — start again.'
        : "Couldn't finish signing in with Claude. Nothing was saved — try again.",
    )

  const tokens = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!tokens.access_token) throw new OAuthError('Claude did not return a token. Start again.')

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: expiryFrom(tokens.expires_in, tokens.access_token),
  }
}

/**
 * Subscription tokens are short-lived. Without this the product works for an
 * hour and then quietly stops, which reads to the user as "it broke" rather
 * than "sign in again".
 */
export async function refreshClaudeToken(refreshToken: string): Promise<ClaudeTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: CLAUDE_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) throw new OAuthError('Your Claude connection expired. Connect it again.')

  const tokens = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!tokens.access_token) throw new OAuthError('Your Claude connection expired. Connect it again.')

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? refreshToken,
    expiresAt: expiryFrom(tokens.expires_in, tokens.access_token),
  }
}

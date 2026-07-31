/**
 * Fireflies, signed in directly — no API key to find and paste.
 *
 * Fireflies' regular API is key-only, which is why Composio's hosted page shows
 * a key form. But Fireflies also runs a public remote MCP server with real
 * OAuth 2.1 — dynamic client registration, PKCE, refresh — at api.fireflies.ai.
 * callcraft discovered and productionised this path; the flow here is that
 * work, ported and trimmed.
 *
 * One deliberate simplification versus callcraft: no resumable checkpoint
 * machinery on the callback. The pending state is deleted BEFORE the code is
 * exchanged, so a replayed callback finds nothing and reports "expired" instead
 * of ever exchanging a consumed single-use code twice. The cost is that a
 * transient exchange failure makes the person start over — a ten-second flow —
 * rather than resuming. That trade is recorded in docs/DECISIONS.md.
 */

const BASE = 'https://api.fireflies.ai'
export const FIREFLIES_MCP_URL = `${BASE}/mcp`
const REGISTER_URL = `${BASE}/register`
const AUTHORIZE_URL = `${BASE}/authorize`
const TOKEN_URL = `${BASE}/token`

export const FIREFLIES_OAUTH_TTL_SECONDS = 15 * 60

export class FirefliesOAuthError extends Error {}

export type FirefliesPending = {
  clientId: string
  verifier: string
  redirectUri: string
  state: string
}

export type FirefliesTokens = {
  accessToken: string
  refreshToken?: string
  clientId: string
  /** Epoch ms, already backed off. */
  expiresAt?: number
}

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

/**
 * The callback must return to the origin the person is actually on — local dev
 * and production have different ones — but never to anything unauthenticated
 * over plain http on the open internet.
 */
export function callbackUriFor(requestOrigin: string): string {
  const url = new URL(requestOrigin)
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')
    throw new FirefliesOAuthError('Sign-in has to happen over a secure connection.')
  return `${url.origin}/api/notetakers/fireflies/callback`
}

/** Pure so the URL shape is testable without the network. */
export function authorizeUrl(clientId: string, redirectUri: string, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'profile email',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // Binds the grant to the MCP server, per RFC 8707. Without it the token
    // that comes back is not valid for the only API we call.
    resource: FIREFLIES_MCP_URL,
  })
  return `${AUTHORIZE_URL}?${params}`
}

/**
 * OAuth 2.1 dynamic client registration: every sign-in registers its own
 * public client, so there is no client secret to hold anywhere.
 */
export async function startFirefliesOAuth(requestOrigin: string): Promise<{ url: string; pending: FirefliesPending }> {
  const redirectUri = callbackUriFor(requestOrigin)

  const registration = await fetch(REGISTER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'TallTrack',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  })
  if (!registration.ok) throw new FirefliesOAuthError('Couldn’t start the Fireflies sign-in. Try again.')

  const registered = (await registration.json()) as { client_id?: string }
  if (!registered.client_id) throw new FirefliesOAuthError('Couldn’t start the Fireflies sign-in. Try again.')

  const verifier = randomUrlSafe(48)
  const state = randomUrlSafe(24)

  return {
    url: authorizeUrl(registered.client_id, redirectUri, state, await s256(verifier)),
    pending: { clientId: registered.client_id, verifier, redirectUri, state },
  }
}

function tokensFrom(body: { access_token?: string; refresh_token?: string; expires_in?: number }, clientId: string): FirefliesTokens {
  if (!body.access_token) throw new FirefliesOAuthError('Fireflies didn’t finish the sign-in. Try again.')
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    clientId,
    expiresAt: body.expires_in ? Date.now() + Math.max(0, Number(body.expires_in) - 30) * 1000 : undefined,
  }
}

export async function exchangeFirefliesCode(code: string, pending: FirefliesPending): Promise<FirefliesTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: pending.clientId,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
      resource: FIREFLIES_MCP_URL,
    }),
  })
  if (!res.ok) throw new FirefliesOAuthError('Fireflies didn’t accept that sign-in. Start again.')
  return tokensFrom((await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }, pending.clientId)
}

export async function refreshFirefliesTokens(tokens: FirefliesTokens): Promise<FirefliesTokens> {
  if (!tokens.refreshToken) throw new FirefliesOAuthError('Your Fireflies connection expired. Connect it again.')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: tokens.clientId,
      resource: FIREFLIES_MCP_URL,
    }),
  })
  if (!res.ok) throw new FirefliesOAuthError('Your Fireflies connection expired. Connect it again.')
  const next = tokensFrom((await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }, tokens.clientId)
  return { ...next, refreshToken: next.refreshToken ?? tokens.refreshToken }
}

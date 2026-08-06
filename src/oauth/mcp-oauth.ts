/**
 * The OAuth 2.1 authorization server for the public MCP connector.
 *
 * The whole point: a stranger runs
 *   claude mcp add talltrack --transport http https://…/mcp
 * with no key. The 401 carries WWW-Authenticate → Claude reads the protected
 * resource metadata → registers a client (DCR) → opens the consent page →
 * one Approve click creates a FRESH workspace and redirects back with a code
 * → Claude exchanges it (PKCE, S256) for tokens. No form, no account step —
 * the approval IS the account.
 *
 * Choices, deliberately boring:
 * - Public clients only (token_endpoint_auth_method "none") — Claude Code and
 *   claude.ai both register public clients. Clients and codes live in KV with
 *   TTLs; tokens live in D1 as SHA-256 hashes beside connector_keys.
 * - The code is deleted before the exchange (same replay rule as the
 *   Fireflies callback): a replayed code finds nothing.
 * - Every approval mints a new workspace. Re-adding the connector makes a new
 *   empty workspace rather than guessing identity — refresh tokens are how a
 *   session keeps its workspace.
 */

import { hashKey } from '../mcp/keys'

type Env = Pick<Cloudflare.Env, 'DB' | 'SESSIONS'>

const CLIENT_PREFIX = 'mcp-oauth:client:'
const CODE_PREFIX = 'mcp-oauth:code:'
const CLIENT_TTL_SECONDS = 90 * 24 * 60 * 60
const CODE_TTL_SECONDS = 10 * 60
export const ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

type StoredClient = { redirectUris: string[] }
type StoredCode = {
  clientId: string
  redirectUri: string
  challenge: string
  workspaceId: string
}

function urlSafe(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function randomToken(prefix: string): string {
  return `${prefix}${urlSafe(crypto.getRandomValues(new Uint8Array(32)))}`
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return urlSafe(new Uint8Array(digest))
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status)
}

/** RFC 9728 — where a 401'd client learns who authorizes this resource. */
export function protectedResourceMetadata(origin: string): Response {
  return json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
  })
}

/** RFC 8414 — the authorization server description Claude discovers. */
export function authorizationServerMetadata(origin: string): Response {
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  })
}

/** RFC 7591 dynamic client registration. Public clients only. */
export async function register(env: Env, request: Request): Promise<Response> {
  let body: { redirect_uris?: unknown }
  try {
    body = (await request.json()) as { redirect_uris?: unknown }
  } catch {
    return oauthError('invalid_client_metadata', 'The registration body must be JSON.')
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))
    : []
  if (redirectUris.length === 0)
    return oauthError('invalid_redirect_uri', 'At least one http(s) redirect_uri is required.')

  const clientId = randomToken('ttc_')
  await env.SESSIONS.put(`${CLIENT_PREFIX}${clientId}`, JSON.stringify({ redirectUris } satisfies StoredClient), {
    expirationTtl: CLIENT_TTL_SECONDS,
  })
  return json(
    {
      client_id: clientId,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    201,
  )
}

type AuthorizeParams = {
  clientId: string
  redirectUri: string
  state: string | null
  challenge: string
}

async function readAuthorizeParams(env: Env, url: URL): Promise<AuthorizeParams | Response> {
  const clientId = url.searchParams.get('client_id') ?? ''
  const redirectUri = url.searchParams.get('redirect_uri') ?? ''
  const challenge = url.searchParams.get('code_challenge') ?? ''
  const method = url.searchParams.get('code_challenge_method') ?? ''
  const responseType = url.searchParams.get('response_type') ?? ''

  const client = await env.SESSIONS.get<StoredClient>(`${CLIENT_PREFIX}${clientId}`, 'json')
  if (!client) return oauthError('invalid_request', 'Unknown client. Register first at /oauth/register.')
  if (!client.redirectUris.includes(redirectUri))
    return oauthError('invalid_request', 'That redirect_uri was not registered by this client.')
  if (responseType !== 'code') return oauthError('unsupported_response_type', 'Only response_type=code is supported.')
  if (method !== 'S256' || !challenge) return oauthError('invalid_request', 'PKCE with S256 is required.')

  return { clientId, redirectUri, state: url.searchParams.get('state'), challenge }
}

/**
 * The consent page. One sentence, one button. The form round-trips the
 * validated parameters; approve re-validates them against the stored client
 * so a tampered form can't redirect anywhere the client didn't register.
 */
export async function authorizePage(env: Env, request: Request): Promise<Response> {
  const params = await readAuthorizeParams(env, new URL(request.url))
  if (params instanceof Response) return params

  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${value.replace(/"/g, '&quot;')}">`

  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect TallTrack</title>
<body style="font-family:system-ui;background:#14110f;color:#f0ece7;display:grid;place-items:center;min-height:95vh;margin:0">
<div style="max-width:26em;padding:0 1.2em">
<p style="font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#a8a09a;margin:0 0 28px">Tall<span style="color:#d97757">Track</span></p>
<h1 style="font-size:1.25rem;margin:0 0 .6em">Use TallTrack inside Claude</h1>
<p style="color:#a8a09a;font-size:.95rem;line-height:1.55;margin:0 0 1.6em">Approving creates a private TallTrack workspace for you and connects it to this Claude session. Your calls and posts stay in your workspace — nobody else's.</p>
<form method="post" action="/oauth/approve">
${hidden('client_id', params.clientId)}${hidden('redirect_uri', params.redirectUri)}${hidden('code_challenge', params.challenge)}${params.state ? hidden('state', params.state) : ''}
<button type="submit" style="width:100%;padding:12px 16px;background:#d97757;border:1px solid #d97757;border-radius:8px;color:#1a1210;font:inherit;font-weight:600;font-size:15px;cursor:pointer">Approve and create my workspace</button>
</form>
<p style="color:#a8a09a;font-size:.8rem;margin-top:1.4em">Not you? Close this tab and nothing happens.</p>
</div>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )
}

/** The Approve click: mint the workspace, mint the one-time code, redirect. */
export async function approve(env: Env, request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null)
  if (!form) return oauthError('invalid_request', 'That approval did not come through. Start over from Claude.')

  const clientId = String(form.get('client_id') ?? '')
  const redirectUri = String(form.get('redirect_uri') ?? '')
  const challenge = String(form.get('code_challenge') ?? '')
  const state = form.get('state')

  const client = await env.SESSIONS.get<StoredClient>(`${CLIENT_PREFIX}${clientId}`, 'json')
  if (!client || !client.redirectUris.includes(redirectUri) || !challenge)
    return oauthError('invalid_request', 'That approval expired or was tampered with. Start over from Claude.')

  const workspaceId = `ws-${crypto.randomUUID()}`
  await env.DB.prepare(`insert into workspaces (id, created_via) values (?1, 'mcp-oauth')`).bind(workspaceId).run()

  const code = randomToken('ttac_')
  await env.SESSIONS.put(
    `${CODE_PREFIX}${code}`,
    JSON.stringify({ clientId, redirectUri, challenge, workspaceId } satisfies StoredCode),
    { expirationTtl: CODE_TTL_SECONDS },
  )

  const target = new URL(redirectUri)
  target.searchParams.set('code', code)
  if (typeof state === 'string' && state) target.searchParams.set('state', state)
  return Response.redirect(target.toString(), 302)
}

async function issueTokens(env: Env, workspaceId: string, clientId: string): Promise<Response> {
  const accessToken = randomToken('ttat_')
  const refreshToken = randomToken('ttrt_')
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString()

  // One live token pair per (workspace, client): a refresh replaces, never accumulates.
  await env.DB.prepare(`delete from mcp_tokens where workspace_id = ?1 and client_id = ?2`)
    .bind(workspaceId, clientId)
    .run()
  await env.DB.prepare(
    `insert into mcp_tokens (token_hash, refresh_hash, workspace_id, client_id, expires_at)
     values (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(await hashKey(accessToken), await hashKey(refreshToken), workspaceId, clientId, expiresAt)
    .run()

  return json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
  })
}

export async function token(env: Env, request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null)
  if (!form) return oauthError('invalid_request', 'The token request must be form-encoded.')
  const grantType = String(form.get('grant_type') ?? '')

  if (grantType === 'authorization_code') {
    const code = String(form.get('code') ?? '')
    const verifier = String(form.get('code_verifier') ?? '')
    const clientId = String(form.get('client_id') ?? '')

    const key = `${CODE_PREFIX}${code}`
    const stored = await env.SESSIONS.get<StoredCode>(key, 'json')
    // Deleted before the exchange: a replayed code finds nothing.
    if (stored) await env.SESSIONS.delete(key)

    if (!stored || stored.clientId !== clientId)
      return oauthError('invalid_grant', 'That code is expired or already used. Start the connection again.')
    if (!verifier || (await s256(verifier)) !== stored.challenge)
      return oauthError('invalid_grant', 'PKCE verification failed.')

    return issueTokens(env, stored.workspaceId, stored.clientId)
  }

  if (grantType === 'refresh_token') {
    const refresh = String(form.get('refresh_token') ?? '')
    if (!refresh) return oauthError('invalid_grant', 'refresh_token is required.')
    const row = await env.DB.prepare(`select workspace_id, client_id from mcp_tokens where refresh_hash = ?1`)
      .bind(await hashKey(refresh))
      .first<{ workspace_id: string; client_id: string }>()
    if (!row) return oauthError('invalid_grant', 'That refresh token is no longer valid. Reconnect from Claude.')
    return issueTokens(env, row.workspace_id, row.client_id)
  }

  return oauthError('unsupported_grant_type', 'Use authorization_code or refresh_token.')
}

/** OAuth bearer token → workspace id, or null. Sits beside workspaceForKey. */
export async function workspaceForOauthToken(env: Env, authorization: string | undefined): Promise<string | null> {
  const match = /^Bearer\s+(ttat_[A-Za-z0-9_-]{20,})$/.exec(authorization ?? '')
  if (!match) return null

  const row = await env.DB.prepare(
    `select workspace_id, expires_at from mcp_tokens where token_hash = ?1`,
  )
    .bind(await hashKey(match[1]!))
    .first<{ workspace_id: string; expires_at: string }>()
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) return null

  await env.DB.prepare(`update mcp_tokens set last_used_at = datetime('now') where token_hash = ?1`)
    .bind(await hashKey(match[1]!))
    .run()
  return row.workspace_id
}

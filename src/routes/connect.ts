import { Hono } from 'hono'
import type { Env } from '../index'
import {
  AUTH_TTL_SECONDS,
  finishClaudeAuth,
  OAuthError,
  startClaudeAuth,
  type PendingAuth,
} from '../providers/claude-oauth'
import { disconnect, listConnections, saveConnection } from '../db/providers'
import { workspaceOf } from '../auth'

export const connect = new Hono<{ Bindings: Env }>()

const PENDING_PREFIX = 'claude-auth:'

/** Opaque, server-issued, and shape-checked before it is ever used as a key. */
function isAuthId(value: unknown): value is string {
  return typeof value === 'string' && /^cauth-[A-Za-z0-9_-]{20,24}$/.test(value)
}

connect.get('/', async (c) => {
  return c.json({ connections: await listConnections(c.env, await workspaceOf(c.req.raw, c.env)) })
})

/**
 * Step one: mint a PKCE challenge and hand back the URL to open.
 *
 * The verifier stays in KV under a server-issued id. If it went to the browser
 * — even briefly, even in a variable — PKCE would degrade to a plain redirect
 * that anyone holding the code could complete.
 */
connect.post('/claude/start', async (c) => {
  const { authId, authorizeUrl, pending } = await startClaudeAuth()
  await c.env.SESSIONS.put(`${PENDING_PREFIX}${authId}`, JSON.stringify(pending), {
    expirationTtl: AUTH_TTL_SECONDS,
  })
  return c.json({ authId, authorizeUrl })
})

/** Step two: exchange the pasted `code#state` for the subscription token. */
connect.post('/claude/finish', async (c) => {
  const workspaceId = await workspaceOf(c.req.raw, c.env)
  const body: { authId?: unknown; code?: unknown } = await c.req
    .json<{ authId?: unknown; code?: unknown }>()
    .catch(() => ({}))

  if (!isAuthId(body.authId))
    return c.json({ error: 'That sign-in has expired. Start again.' }, 400)

  const key = `${PENDING_PREFIX}${body.authId}`
  const pending = await c.env.SESSIONS.get<PendingAuth>(key, 'json')
  if (!pending) return c.json({ error: 'That sign-in timed out. Start again.' }, 400)

  try {
    const tokens = await finishClaudeAuth(typeof body.code === 'string' ? body.code : '', pending)
    const connection = await saveConnection(c.env, workspaceId, 'claude', 'subscription', tokens)
    // One-time by construction: burn it whether or not a later step fails.
    await c.env.SESSIONS.delete(key)
    return c.json({ connection })
  } catch (err) {
    if (err instanceof OAuthError) {
      // A rejected code is spent — leaving it live invites replay attempts.
      await c.env.SESSIONS.delete(key)
      return c.json({ error: err.message }, 400)
    }
    // Never echo a provider body: it can contain the token.
    return c.json({ error: 'Something went wrong signing in. Nothing was saved — try again.' }, 500)
  }
})

connect.delete('/claude', async (c) => {
  await disconnect(c.env, await workspaceOf(c.req.raw, c.env), 'claude')
  return c.json({ ok: true })
})

import { Hono } from 'hono'
import type { Env } from '../index'
import { workspaceOf } from '../auth'
import {
  ComposioError,
  accountStatus,
  createConnectLink,
  isConnected,
  isNotetaker,
  NOTETAKER_LABEL,
} from '../ingest/composio'
import {
  FIREFLIES_OAUTH_TTL_SECONDS,
  FirefliesOAuthError,
  exchangeFirefliesCode,
  startFirefliesOAuth,
  type FirefliesPending,
} from '../ingest/fireflies-oauth'
import { seal } from '../crypto/envelope'
import {
  getNotetaker,
  listNotetakers,
  markActive,
  markPending,
  removeNotetaker,
  sealCredential,
} from '../db/notetakers'

export const notetakers = new Hono<{ Bindings: Env }>()

const FIREFLIES_PENDING_PREFIX = 'fireflies-oauth:'

notetakers.get('/', async (c) => {
  return c.json({ notetakers: await listNotetakers(c.env, workspaceOf(c.req.raw)) })
})

/**
 * One click, two shapes behind one endpoint.
 *
 * Fathom and Gong: Composio hosts the provider sign-in and vaults the
 * credential; we get back a hosted link.
 *
 * Fireflies: its API is key-only, so Composio could only show a key form —
 * instead we run OAuth directly against Fireflies' MCP server, which is a real
 * sign-in page. The UI cannot tell the difference: both return a redirectUrl.
 */
notetakers.post('/:provider/start', async (c) => {
  const provider = c.req.param('provider')
  if (!isNotetaker(provider)) return c.json({ error: 'Unknown notetaker.' }, 404)

  const workspaceId = workspaceOf(c.req.raw)

  try {
    if (provider === 'fireflies') {
      const { url, pending } = await startFirefliesOAuth(new URL(c.req.url).origin)
      // Keyed by state — the one thing the callback is guaranteed to carry.
      await c.env.SESSIONS.put(
        `${FIREFLIES_PENDING_PREFIX}${pending.state}`,
        JSON.stringify({ ...pending, workspaceId }),
        { expirationTtl: FIREFLIES_OAUTH_TTL_SECONDS },
      )
      await markPending(c.env, workspaceId, provider, `fireflies:${pending.clientId}`)
      return c.json({ redirectUrl: url })
    }

    const { redirectUrl, connectedAccountId } = await createConnectLink(c.env, provider, workspaceId)
    await markPending(c.env, workspaceId, provider, connectedAccountId)
    return c.json({ redirectUrl })
  } catch (err) {
    if (err instanceof ComposioError || err instanceof FirefliesOAuthError)
      return c.json({ error: err.message }, 400)
    return c.json({ error: `Couldn’t start the ${NOTETAKER_LABEL[provider]} sign-in. Try again.` }, 500)
  }
})

/**
 * Where Fireflies sends the person back. This is a browser navigation, not an
 * API call, so it answers in HTML — a plain sentence, not JSON.
 *
 * The pending state is deleted BEFORE the exchange: a replayed callback then
 * finds nothing and reads "expired", and a consumed single-use code is never
 * exchanged twice. The trade (a transient failure means starting over) is
 * recorded in docs/DECISIONS.md.
 */
notetakers.get('/fireflies/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')

  const page = (title: string, line: string, ok: boolean) =>
    c.html(
      `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;background:#14110f;color:#f0ece7;display:grid;place-items:center;min-height:95vh;margin:0">
<div style="text-align:center;max-width:26em;padding:0 1em">
<p style="font-size:2rem;margin:0 0 .4em">${ok ? '✓' : '✕'}</p>
<h1 style="font-size:1.15rem;margin:0 0 .5em">${title}</h1>
<p style="color:#a8a09a;font-size:.95rem">${line}</p>
</div>`,
      ok ? 200 : 400,
    )

  if (!code || !state)
    return page('That didn’t come through', 'Go back to TallTrack and hit connect again.', false)

  const key = `${FIREFLIES_PENDING_PREFIX}${state}`
  const pending = await c.env.SESSIONS.get<FirefliesPending & { workspaceId: string }>(key, 'json')
  if (!pending)
    return page('That sign-in expired', 'Go back to TallTrack and hit connect again.', false)

  await c.env.SESSIONS.delete(key)

  try {
    const tokens = await exchangeFirefliesCode(code, pending)
    const sealed = await seal(JSON.stringify(tokens), c.env.MASTER_KEY)
    await sealCredential(c.env, pending.workspaceId, 'fireflies', JSON.stringify(sealed))
    await markActive(c.env, pending.workspaceId, 'fireflies')
    return page('Fireflies connected', 'You can close this tab — TallTrack has picked it up.', true)
  } catch (err) {
    const line =
      err instanceof FirefliesOAuthError ? err.message : 'Something went wrong. Nothing was saved — try again.'
    return page('That didn’t work', line, false)
  }
})

/**
 * Polled while the other tab is open. Fireflies rows are flipped ACTIVE by the
 * callback above; Composio rows are confirmed against Composio, matched on the
 * exact account and auth config.
 */
notetakers.get('/:provider/status', async (c) => {
  const provider = c.req.param('provider')
  if (!isNotetaker(provider)) return c.json({ error: 'Unknown notetaker.' }, 404)

  const workspaceId = workspaceOf(c.req.raw)
  const row = await getNotetaker(c.env, workspaceId, provider)
  if (!row) return c.json({ status: 'NONE' })
  if (row.status === 'ACTIVE') return c.json({ status: 'ACTIVE' })
  if (provider === 'fireflies') return c.json({ status: 'PENDING' })

  try {
    const status = await accountStatus(c.env, provider, workspaceId, row.connectedAccountId)
    if (isConnected(status)) {
      await markActive(c.env, workspaceId, provider)
      return c.json({ status: 'ACTIVE' })
    }
    return c.json({ status: 'PENDING' })
  } catch (err) {
    if (err instanceof ComposioError) return c.json({ error: err.message }, 400)
    return c.json({ error: 'Couldn’t check that connection. Try again.' }, 500)
  }
})

notetakers.delete('/:provider', async (c) => {
  const provider = c.req.param('provider')
  if (!isNotetaker(provider)) return c.json({ error: 'Unknown notetaker.' }, 404)
  await removeNotetaker(c.env, workspaceOf(c.req.raw), provider)
  return c.json({ ok: true })
})

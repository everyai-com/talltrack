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
import { getNotetaker, listNotetakers, markActive, markPending, removeNotetaker } from '../db/notetakers'

export const notetakers = new Hono<{ Bindings: Env }>()

notetakers.get('/', async (c) => {
  return c.json({ notetakers: await listNotetakers(c.env, workspaceOf(c.req.raw)) })
})

/**
 * One click: mint the hosted sign-in link and record the pending approval
 * before handing the URL back. Writing the row first is what makes the poll
 * survive a refresh — if the id only lived in the browser, closing the tab
 * would strand an approval that Composio thinks succeeded.
 */
notetakers.post('/:provider/start', async (c) => {
  const provider = c.req.param('provider')
  if (!isNotetaker(provider)) return c.json({ error: 'Unknown notetaker.' }, 404)

  const workspaceId = workspaceOf(c.req.raw)

  try {
    const { redirectUrl, connectedAccountId } = await createConnectLink(c.env, provider, workspaceId)
    await markPending(c.env, workspaceId, provider, connectedAccountId)
    return c.json({ redirectUrl })
  } catch (err) {
    if (err instanceof ComposioError) return c.json({ error: err.message }, 400)
    return c.json({ error: `Couldn’t start the ${NOTETAKER_LABEL[provider]} sign-in. Try again.` }, 500)
  }
})

/**
 * Polled while the other tab is open. Composio is the source of truth for
 * whether the approval landed — our row only mirrors it, and only ever after
 * Composio says ACTIVE for this exact account.
 */
notetakers.get('/:provider/status', async (c) => {
  const provider = c.req.param('provider')
  if (!isNotetaker(provider)) return c.json({ error: 'Unknown notetaker.' }, 404)

  const workspaceId = workspaceOf(c.req.raw)
  const row = await getNotetaker(c.env, workspaceId, provider)
  if (!row) return c.json({ status: 'NONE' })
  if (row.status === 'ACTIVE') return c.json({ status: 'ACTIVE' })

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

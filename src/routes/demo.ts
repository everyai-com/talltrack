import { Hono } from 'hono'
import type { Env } from '../index'
import { workspaceOf } from '../auth'
import { saveCall } from '../db/calls'

export const demo = new Hono<{ Bindings: Env }>()

type DemoCall = {
  id?: unknown
  title?: unknown
  occurredAt?: unknown
  transcript?: unknown
}

/**
 * Local dogfood only. This lets the founder test the writer without waiting
 * for a Fathom connection. It is unreachable unless the Worker is explicitly
 * started with TALLTRACK_DEMO_MODE=1; production has no such binding.
 */
demo.post('/seed', async (c) => {
  if (c.env.TALLTRACK_DEMO_MODE !== '1') return c.json({ error: 'not found' }, 404)

  let body: { calls?: unknown } = {}
  try {
    body = await c.req.json<{ calls?: unknown }>()
  } catch {
    return c.json({ error: 'Send JSON with a calls array.' }, 400)
  }
  if (!Array.isArray(body.calls) || body.calls.length === 0 || body.calls.length > 12)
    return c.json({ error: 'Send between 1 and 12 demo calls.' }, 400)

  const calls = body.calls as DemoCall[]
  if (calls.some((call) =>
    typeof call.id !== 'string'
      || !/^demo-[A-Za-z0-9._-]+$/.test(call.id)
      || typeof call.title !== 'string'
      || typeof call.occurredAt !== 'string'
      || !Number.isFinite(Date.parse(call.occurredAt))
      || typeof call.transcript !== 'string'
      || call.transcript.trim().length < 80
  )) return c.json({ error: 'Every demo call needs an id, title, date, and readable transcript.' }, 400)

  const workspaceId = await workspaceOf(c.req.raw, c.env)
  for (const call of calls) {
    await saveCall(c.env, workspaceId, 'demo', {
      externalId: call.id as string,
      title: call.title as string,
      occurredAt: call.occurredAt as string,
      durationS: 0,
      providerUrl: null,
      transcript: call.transcript as string,
    })
  }

  return c.json({ seeded: calls.length, source: 'demo', included: calls.map((call) => ({
    id: call.id,
    title: call.title,
    occurredAt: call.occurredAt,
  })) })
})

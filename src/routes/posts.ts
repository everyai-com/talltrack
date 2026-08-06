import { Hono } from 'hono'
import type { Env } from '../index'
import { workspaceOf } from '../auth'
import { isPostOutcome, recordOutcome } from '../db/posts'

export const posts = new Hono<{ Bindings: Env }>()

posts.post('/:id/outcome', async (c) => {
  const body = await c.req.json<{
    outcome?: unknown
    publishedBody?: unknown
    rejectReason?: unknown
  }>().catch(() => ({ outcome: undefined, publishedBody: undefined, rejectReason: undefined }))

  if (!isPostOutcome(body.outcome)) return c.json({ error: 'Choose published, edited, or rejected.' }, 400)

  const publishedBody = typeof body.publishedBody === 'string' ? body.publishedBody : undefined
  const rejectReason = typeof body.rejectReason === 'string' ? body.rejectReason : undefined
  if (body.outcome === 'published_after_edit' && !publishedBody?.trim())
    return c.json({ error: 'Add the version you actually published.' }, 400)

  try {
    const updated = await recordOutcome(
      c.env,
      await workspaceOf(c.req.raw, c.env),
      c.req.param('id'),
      body.outcome,
      publishedBody,
      rejectReason,
    )
    if (!updated) return c.json({ error: 'That post is no longer here.' }, 404)
    return c.json({ ok: true, outcome: body.outcome })
  } catch {
    return c.json({ error: 'Couldn’t save that outcome. Try again.' }, 500)
  }
})

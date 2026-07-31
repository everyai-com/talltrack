import { Hono } from 'hono'
import type { Env } from '../index'

export const health = new Hono<{ Bindings: Env }>()

/**
 * Liveness plus a real check that every binding resolved. A Worker that boots
 * with a mis-wired D1 binding looks healthy right up until the first write, so
 * this touches the database rather than only reporting that the object exists.
 */
health.get('/', async (c) => {
  const bindings: Record<string, boolean> = {
    db: false,
    sessions: false,
    transcripts: false,
  }

  try {
    await c.env.DB.prepare('select 1').first()
    bindings.db = true
  } catch {
    // Reported as false below; never surfaced as a stack trace.
  }

  bindings.sessions = typeof c.env.SESSIONS?.get === 'function'
  bindings.transcripts = typeof c.env.TRANSCRIPTS?.get === 'function'

  const ok = Object.values(bindings).every(Boolean)
  return c.json({ ok, service: 'talltrack', bindings }, ok ? 200 : 503)
})

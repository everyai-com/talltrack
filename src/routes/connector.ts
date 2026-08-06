import { Hono } from 'hono'
import type { Env } from '../index'
import { workspaceOf } from '../auth'
import { issueKey, keyInfo, revokeKey } from '../mcp/keys'

export const connector = new Hono<{ Bindings: Env }>()

/**
 * The paste-able one-liner. Built server-side so the UI, the docs and reality
 * can never disagree about its shape.
 */
function snippetFor(origin: string, key: string): { claudeCode: string; mcpUrl: string } {
  return {
    claudeCode: `claude mcp add talltrack --transport http ${origin}/mcp --header "Authorization: Bearer ${key}"`,
    mcpUrl: `${origin}/mcp`,
  }
}

connector.get('/', async (c) => {
  const info = await keyInfo(c.env, await workspaceOf(c.req.raw, c.env))
  return c.json({ connector: info })
})

/**
 * Issues (or rotates) the key. The full key appears in this response and never
 * again — only its hash survives server-side. Rotating invalidates the old key
 * immediately, which is also the "I pasted it somewhere I shouldn't have" fix.
 */
connector.post('/key', async (c) => {
  const key = await issueKey(c.env, await workspaceOf(c.req.raw, c.env))
  return c.json({ key, ...snippetFor(new URL(c.req.url).origin, key) })
})

connector.delete('/key', async (c) => {
  await revokeKey(c.env, await workspaceOf(c.req.raw, c.env))
  return c.json({ ok: true })
})

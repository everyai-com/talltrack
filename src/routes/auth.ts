import { Hono } from 'hono'
import type { Env } from '../index'
import {
  accessCodeMatches,
  clearSessionCookie,
  issueSessionCookie,
  isBrowserAuthenticated,
} from '../auth'

export const auth = new Hono<{ Bindings: Env }>()

auth.get('/status', async (c) => {
  const required = Boolean(c.env.TALLTRACK_ACCESS_TOKEN)
  return c.json({ required, authenticated: required ? await isBrowserAuthenticated(c.req.raw, c.env) : true })
})

auth.post('/login', async (c) => {
  const body = await c.req.json<{ accessToken?: unknown }>().catch(() => ({ accessToken: undefined }))
  if (!c.env.TALLTRACK_ACCESS_TOKEN) return c.json({ ok: true, required: false })
  if (!(await accessCodeMatches(c.env, body.accessToken))) return c.json({ error: 'That access code didn’t work.' }, 401)

  c.header('Set-Cookie', await issueSessionCookie(c.env))
  return c.json({ ok: true, required: true })
})

auth.post('/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookie())
  return c.json({ ok: true })
})

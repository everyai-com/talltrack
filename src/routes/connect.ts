import { Hono } from 'hono'
import type { Env } from '../index'
import { CredentialError, claudeAuthHeaders, parseClaudeCredential } from '../providers/claude-credential'
import { disconnect, listConnections, saveConnection } from '../db/providers'
import { workspaceOf } from '../auth'

export const connect = new Hono<{ Bindings: Env }>()

/**
 * The whole point of validating before storing: a token that was mistyped, or
 * already expired, or minted for a different account, should fail here — on the
 * screen where the person can fix it — rather than silently at 6am on the first
 * real run, when nothing is watching and the only symptom is an empty week.
 */
async function verifyClaude(secret: string, kind: 'subscription' | 'api_key'): Promise<void> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...claudeAuthHeaders({ kind, secret }),
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  })

  if (res.ok) return
  if (res.status === 401 || res.status === 403)
    throw new CredentialError(
      kind === 'subscription'
        ? "Claude didn't accept that token. They expire — run the command again and paste the new one."
        : "Claude didn't accept that key. Check it's the whole thing and still active.",
    )
  if (res.status === 429)
    throw new CredentialError('Your Claude account is rate limited right now. Try connecting again in a few minutes.')
  throw new CredentialError("Couldn't reach Claude to check that token. Nothing was saved — try again.")
}

connect.get('/', async (c) => {
  const workspaceId = workspaceOf(c.req.raw)
  return c.json({ connections: await listConnections(c.env, workspaceId) })
})

connect.post('/claude', async (c) => {
  const workspaceId = workspaceOf(c.req.raw)
  const body = await c.req.json<{ token?: unknown }>().catch(() => ({ token: undefined }))

  try {
    const cred = parseClaudeCredential(typeof body.token === 'string' ? body.token : '')
    await verifyClaude(cred.secret, cred.kind)
    const connection = await saveConnection(c.env, workspaceId, 'claude', cred)
    return c.json({ connection })
  } catch (err) {
    // Only our own messages reach a person. Anything else would risk echoing a
    // provider body, and a provider body can contain the credential.
    if (err instanceof CredentialError) return c.json({ error: err.message }, 400)
    return c.json({ error: 'Something went wrong saving that. Nothing was stored — try again.' }, 500)
  }
})

connect.delete('/claude', async (c) => {
  await disconnect(c.env, workspaceOf(c.req.raw), 'claude')
  return c.json({ ok: true })
})

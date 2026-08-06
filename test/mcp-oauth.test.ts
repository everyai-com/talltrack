import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

/**
 * The public front door: a bare `claude mcp add <url>` discovers the OAuth
 * server from the 401, registers, gets approved, and lands in a FRESH
 * workspace. This walks the whole flow the way Claude Code does.
 */

const ORIGIN = 'https://talltrack.test'
const REDIRECT = 'https://client.example/callback'

function s256(verifier: string): Promise<string> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then((d) =>
    btoa(String.fromCharCode(...new Uint8Array(d)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, ''),
  )
}

async function runFlow(): Promise<string> {
  const reg = await SELF.fetch(`${ORIGIN}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT] }),
  })
  expect(reg.status).toBe(201)
  const { client_id } = (await reg.json()) as { client_id: string }

  const verifier = 'test-verifier-that-is-long-enough-for-pkce-rules'
  const challenge = await s256(verifier)

  const consent = await SELF.fetch(
    `${ORIGIN}/oauth/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&state=xyz&code_challenge=${challenge}&code_challenge_method=S256`,
  )
  expect(consent.status).toBe(200)
  expect(await consent.text()).toContain('Approve and create my workspace')

  const form = new FormData()
  form.set('client_id', client_id)
  form.set('redirect_uri', REDIRECT)
  form.set('code_challenge', challenge)
  form.set('state', 'xyz')
  const approved = await SELF.fetch(`${ORIGIN}/oauth/approve`, { method: 'POST', body: form, redirect: 'manual' })
  expect(approved.status).toBe(302)
  const location = new URL(approved.headers.get('location')!)
  expect(location.searchParams.get('state')).toBe('xyz')
  const code = location.searchParams.get('code')!

  const tokenForm = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id,
  })
  const tokenRes = await SELF.fetch(`${ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: tokenForm,
  })
  expect(tokenRes.status).toBe(200)
  const tokens = (await tokenRes.json()) as { access_token: string }
  return tokens.access_token
}

describe('MCP OAuth', () => {
  it('401s the bare endpoint with discovery metadata', async () => {
    const res = await SELF.fetch(`${ORIGIN}/mcp`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('oauth-protected-resource')

    const meta = await SELF.fetch(`${ORIGIN}/.well-known/oauth-authorization-server`)
    const body = (await meta.json()) as { registration_endpoint: string }
    expect(body.registration_endpoint).toBe(`${ORIGIN}/oauth/register`)
  })

  it('walks register → authorize → approve → token → fresh empty workspace', async () => {
    const accessToken = await runFlow()

    const week = await SELF.fetch(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'this_week', arguments: {} },
      }),
    })
    expect(week.status).toBe(200)
    const result = (await week.json()) as { result: { content: Array<{ text: string }> } }
    // A brand-new workspace has no calls — and says so honestly.
    expect(result.result.content[0]!.text).toContain('No calls')
  })

  it('never lets a code be exchanged twice', async () => {
    // Full flow once more to get a used code indirectly: replay the exchange.
    const reg = await SELF.fetch(`${ORIGIN}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [REDIRECT] }),
    })
    const { client_id } = (await reg.json()) as { client_id: string }
    const verifier = 'second-verifier-that-is-long-enough-for-pkce'
    const challenge = await s256(verifier)
    const form = new FormData()
    form.set('client_id', client_id)
    form.set('redirect_uri', REDIRECT)
    form.set('code_challenge', challenge)
    const approved = await SELF.fetch(`${ORIGIN}/oauth/approve`, { method: 'POST', body: form, redirect: 'manual' })
    const code = new URL(approved.headers.get('location')!).searchParams.get('code')!

    const body = () =>
      new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id })
    const first = await SELF.fetch(`${ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body(),
    })
    expect(first.status).toBe(200)
    const replay = await SELF.fetch(`${ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body(),
    })
    expect(replay.status).toBe(400)
  })
})

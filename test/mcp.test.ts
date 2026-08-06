import { env, SELF } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { issueKey } from '../src/mcp/keys'
import { saveCall } from '../src/db/calls'
import { saveProfile } from '../src/profile'
import { audienceContext, loadProfile } from '../src/profile'
import { buildEditorialContext } from '../src/writer/write'

const URL = 'https://talltrack.test/mcp'

let key: string

beforeAll(async () => {
  key = await issueKey(env, 'solo')
  await saveCall(env, 'solo', 'fathom', {
    externalId: 'mcp-1',
    title: 'Acme pricing call',
    occurredAt: new Date().toISOString(),
    durationS: 1800,
    providerUrl: null,
    transcript: 'Priya: the balance date was the whole problem.\nSam: and we signed off anyway.',
  })
  await saveProfile(env, 'solo', {
    who: 'TallTrack founder.',
    audience: 'Operators who need a clear week.',
    voice: 'Direct and warm.',
    derivedFromCalls: 1,
    derivedAt: new Date().toISOString(),
  })
})

function rpc(body: unknown, auth?: string): Promise<Response> {
  return SELF.fetch(URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('auth', () => {
  it('rejects a missing key with a human sentence', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('/start')
  })

  it('rejects a wrong key', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, `Bearer tt_${'x'.repeat(40)}`)
    expect(res.status).toBe(401)
  })

  it('rejects a key in any shape other than a bearer header', async () => {
    const res = await SELF.fetch(`${URL}?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('protocol', () => {
  it('initializes', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, `Bearer ${key}`)
    const body = (await res.json()) as { result: { protocolVersion: string; serverInfo: { name: string } } }
    expect(body.result.serverInfo.name).toBe('talltrack')
    expect(body.result.protocolVersion).toBeTruthy()
  })

  it('accepts the initialized notification with an empty 202', async () => {
    const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, `Bearer ${key}`)
    expect(res.status).toBe(202)
  })

  it('lists the six tools', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, `Bearer ${key}`)
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } }
    expect(body.result.tools.map((t) => t.name).sort()).toEqual([
      'connect_notetaker',
      'notetaker_status',
      'read_call',
      'save_post',
      'this_week',
      'writing_guide',
    ])
  })
})

describe('tools', () => {
  function call(name: string, args: Record<string, unknown> = {}) {
    return rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }, `Bearer ${key}`)
  }

  async function textOf(res: Response): Promise<string> {
    const body = (await res.json()) as { result: { content: Array<{ text: string }> } }
    return body.result.content[0]!.text
  }

  it('this_week lists the seeded call without its transcript', async () => {
    const text = await textOf(await call('this_week'))
    expect(text).toContain('Acme pricing call')
    expect(text).not.toContain('balance date')
  })

  it('read_call returns the whole transcript', async () => {
    const text = await textOf(await call('read_call', { call_id: 'solo:fathom:mcp-1' }))
    expect(text).toContain('the balance date was the whole problem')
    expect(text).toContain('signed off anyway')
  })

  it('writing_guide carries the same full context as the browser writer', async () => {
    const text = await textOf(await call('writing_guide'))
    expect(text).toContain('You are allowed to return zero posts')
    expect(text).toContain('Direct and warm.')
    expect(text).toContain('AIOS LINKEDIN WRITING GUIDE')
    expect(text).not.toContain('CALLCRAFT STRUCTURAL BLUEPRINT CATALOG')
    const profile = await loadProfile(env, 'solo')
    expect(text).toBe(buildEditorialContext({ audience: profile ? audienceContext(profile) : undefined, publishedExamples: [] }))
  })

  it('save_post lands on the front door', async () => {
    const text = await textOf(
      await call('save_post', { body: 'A real post.', tension: 'expected vs actual', call_ids: ['solo:fathom:mcp-1'] }),
    )
    expect(text).toContain('Saved')

    const row = await env.DB.prepare(
      `select body, tension from posts where workspace_id = 'solo' order by created_at desc limit 1`,
    ).first<{ body: string; tension: string }>()
    expect(row).toMatchObject({ body: 'A real post.', tension: 'expected vs actual' })
  })

  it('refuses save_post without a tension — law 2 survives the connector', async () => {
    const res = await call('save_post', { body: 'A post with no stated tension.' })
    const body = (await res.json()) as { result: { isError?: boolean } }
    expect(body.result.isError).toBe(true)
  })

  it('read_call with a stranger id says so plainly', async () => {
    const res = await call('read_call', { call_id: 'someone-elses-call' })
    const body = (await res.json()) as { result: { isError?: boolean; content: Array<{ text: string }> } }
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0]!.text).toContain('this_week')
  })
})

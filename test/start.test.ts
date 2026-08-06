import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

/**
 * The zero-friction front door: one click mints a workspace + key and hands
 * back a complete, paste-ready `claude mcp add` command. This is the path
 * for sessions that can't run the OAuth browser flow.
 */

const ORIGIN = 'https://talltrack.test'

describe('/start', () => {
  it('serves the onboarding page without any auth', async () => {
    const res = await SELF.fetch(`${ORIGIN}/start`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Create my workspace')
  })

  it('mints a workspace whose key opens the MCP with an honest empty week', async () => {
    const res = await SELF.fetch(`${ORIGIN}/start/workspace`, { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { workspaceId: string; command: string }
    expect(body.workspaceId).toMatch(/^ws-/)
    expect(body.command).toContain(`${ORIGIN}/mcp`)

    const key = /Bearer (tt_[A-Za-z0-9_-]+)/.exec(body.command)![1]!
    const week = await SELF.fetch(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'this_week', arguments: {} },
      }),
    })
    const result = (await week.json()) as { result: { content: Array<{ text: string }> } }
    // Fresh workspace: no calls, and the guidance to connect a notetaker.
    expect(result.result.content[0]!.text).toContain('connect_notetaker')
  })
})

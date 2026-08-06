import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('local demo seed', () => {
  it('is unreachable unless explicitly enabled', async () => {
    const response = await SELF.fetch('https://talltrack.test/api/demo/seed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ calls: [] }),
    })
    expect(response.status).toBe(404)
  })

  it('does not accidentally add a demo switch to test bindings', () => {
    expect(env.TALLTRACK_DEMO_MODE).not.toBe('1')
  })
})

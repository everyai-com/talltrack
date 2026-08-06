import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('provider-aware week routes', () => {
  it('returns a per-provider sync result without pretending unsupported readers ran', async () => {
    const response = await SELF.fetch('https://talltrack.test/api/week/sync', { method: 'POST' })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      providers: Array<{ provider: string; readReady: boolean; skippedReason?: string }>
    }
    expect(body.providers.map((provider) => provider.provider)).toEqual(['fathom', 'gong', 'fireflies'])
    expect(body.providers.find((provider) => provider.provider === 'gong')).toMatchObject({
      readReady: false,
      skippedReason: expect.stringContaining('transcript'),
    })
  })

  it('exposes the readiness contract to the front door', async () => {
    const response = await SELF.fetch('https://talltrack.test/api/week')
    const body = (await response.json()) as { providerCapabilities: Record<string, { readReady: boolean }> }
    expect(body.providerCapabilities).toMatchObject({
      fathom: { readReady: true },
      gong: { readReady: false },
      fireflies: { readReady: false },
    })
  })
})

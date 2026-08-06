import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { markActive, markPending } from '../src/db/notetakers'

describe('notetaker reconnect guard', () => {
  beforeEach(async () => {
    await env.DB.prepare(`delete from notetakers`).run()
  })

  it('does not replace a working Fathom connection with a pending one', async () => {
    await markPending(env, 'solo', 'fathom', 'existing-account')
    await markActive(env, 'solo', 'fathom')

    const response = await SELF.fetch('https://talltrack.test/api/notetakers/fathom/start', { method: 'POST' })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Fathom is already connected. Disconnect it first to reconnect.',
    })

    const row = await env.DB.prepare(
      `select connected_account_id, status from notetakers where workspace_id = 'solo' and provider = 'fathom'`,
    ).first<{ connected_account_id: string; status: string }>()
    expect(row).toEqual({ connected_account_id: 'existing-account', status: 'ACTIVE' })
  })
})

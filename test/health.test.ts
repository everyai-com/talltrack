import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('health', () => {
  it('reports every binding wired', async () => {
    const res = await SELF.fetch('https://talltrack.test/api/health')
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      ok: boolean
      service: string
      bindings: Record<string, boolean>
    }
    expect(body.service).toBe('talltrack')
    expect(body.ok).toBe(true)
    expect(body.bindings).toEqual({ db: true, sessions: true, transcripts: true })
  })

  it('says so plainly when an api route does not exist', async () => {
    const res = await SELF.fetch('https://talltrack.test/api/nope')
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'no such endpoint' })
  })

  it('has the bindings the health check claims', () => {
    expect(env.DB).toBeDefined()
    expect(env.SESSIONS).toBeDefined()
    expect(env.TRANSCRIPTS).toBeDefined()
  })
})

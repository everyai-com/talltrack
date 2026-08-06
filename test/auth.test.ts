import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import {
  accessCodeMatches,
  issueSessionCookie,
  SOLO_WORKSPACE,
  workspaceOf,
} from '../src/auth'

const secured = { TALLTRACK_ACCESS_TOKEN: 'founder-only-test-code' }

describe('founder dogfood access gate', () => {
  it('keeps local workspaces on the isolated solo identity', async () => {
    expect(await workspaceOf(new Request('https://talltrack.test/api/week'), {})).toBe(SOLO_WORKSPACE)
  })

  it('does not accept a missing or incorrect session', async () => {
    await expect(workspaceOf(new Request('https://talltrack.test/api/week'), secured)).rejects.toThrow(
      'Sign in to TallTrack',
    )
    await expect(
      workspaceOf(
        new Request('https://talltrack.test/api/week', { headers: { cookie: 'tt_session=not-a-session' } }),
        secured,
      ),
    ).rejects.toThrow('Sign in to TallTrack')
  })

  it('uses a signed HttpOnly cookie and never stores the access code in it', async () => {
    const cookie = await issueSessionCookie(secured)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).not.toContain(secured.TALLTRACK_ACCESS_TOKEN)

    const request = new Request('https://talltrack.test/api/week', { headers: { cookie: cookie.split(';')[0]! } })
    expect(await workspaceOf(request, secured)).toBe(SOLO_WORKSPACE)
    expect(await accessCodeMatches(secured, secured.TALLTRACK_ACCESS_TOKEN)).toBe(true)
    expect(await accessCodeMatches(secured, 'wrong')).toBe(false)
  })

  it('blocks workspace APIs when the deployment gate is configured', async () => {
    const gatedEnv = { ...env, ...secured }
    const blocked = await app.fetch(new Request('https://talltrack.test/api/week'), gatedEnv, {} as ExecutionContext)
    expect(blocked.status).toBe(401)
    await expect(blocked.json()).resolves.toEqual({ error: 'Sign in to TallTrack to continue.' })

    const health = await app.fetch(new Request('https://talltrack.test/api/health'), gatedEnv, {} as ExecutionContext)
    expect(health.status).toBe(200)

    const login = await app.fetch(
      new Request('https://talltrack.test/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessToken: secured.TALLTRACK_ACCESS_TOKEN }),
      }),
      gatedEnv,
      {} as ExecutionContext,
    )
    expect(login.status).toBe(200)
    expect(login.headers.get('set-cookie')).toContain('tt_session=')
  })
})

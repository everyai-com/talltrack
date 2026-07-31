import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { audienceContext, loadProfile, parseProfile, saveProfile } from '../src/profile'
import { newExternalIds } from '../src/ingest/sync'

describe('parsing a derived profile', () => {
  it('reads a clean response', () => {
    const p = parseProfile(
      JSON.stringify({ who: 'Founder of X.', audience: 'Ops leads at mid-size shops.', voice: 'Fast, plain.' }),
      5,
    )
    expect(p.who).toBe('Founder of X.')
    expect(p.derivedFromCalls).toBe(5)
  })

  it('refuses an incomplete profile rather than padding it', () => {
    // A profile with a missing audience silently becomes a generic writer —
    // worse than failing, because nobody notices.
    expect(() => parseProfile(JSON.stringify({ who: 'Someone.' }), 3)).toThrow('profile_incomplete')
  })

  it('survives a fenced response', () => {
    const text = '```json\n{"who":"A.","audience":"B.","voice":""}\n```'
    expect(parseProfile(text, 1).audience).toBe('B.')
  })
})

describe('profile storage', () => {
  it('round-trips and upserts', async () => {
    const first = parseProfile(JSON.stringify({ who: 'v1', audience: 'a1', voice: '' }), 2)
    await saveProfile(env, 'profile-test', first)

    const second = parseProfile(JSON.stringify({ who: 'v2', audience: 'a2', voice: 'calm' }), 6)
    await saveProfile(env, 'profile-test', second)

    const loaded = await loadProfile(env, 'profile-test')
    expect(loaded).toMatchObject({ who: 'v2', audience: 'a2', voice: 'calm', derivedFromCalls: 6 })
  })

  it('returns null rather than an empty profile when none exists', async () => {
    expect(await loadProfile(env, 'nobody')).toBeNull()
  })
})

describe('audience context', () => {
  it('carries who, reader and voice in one block', () => {
    const text = audienceContext({
      who: 'Runs TallTrack.',
      audience: 'Heads of sales.',
      voice: 'Direct.',
      derivedFromCalls: 4,
      derivedAt: 'now',
    })
    expect(text).toContain('Runs TallTrack.')
    expect(text).toContain('Heads of sales.')
    expect(text).toContain('Direct.')
  })
})

describe('sync dedup', () => {
  it('pulls only calls not already stored', () => {
    const listed = [{ externalId: 'a' }, { externalId: 'b' }, { externalId: '' }, { externalId: 'c' }]
    expect(newExternalIds(listed, new Set(['b']))).toEqual(['a', 'c'])
  })
})

import { describe, expect, it } from 'vitest'
import {
  CLAUDE_CLIENT_ID,
  CLAUDE_REDIRECT,
  finishClaudeAuth,
  OAuthError,
  startClaudeAuth,
  type PendingAuth,
} from '../src/providers/claude-oauth'

describe('starting sign-in', () => {
  it('builds an authorize url with PKCE', async () => {
    const { authorizeUrl, authId, pending } = await startClaudeAuth()
    const url = new URL(authorizeUrl)

    expect(url.origin + url.pathname).toBe('https://claude.ai/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe(CLAUDE_CLIENT_ID)
    expect(url.searchParams.get('redirect_uri')).toBe(CLAUDE_REDIRECT)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('response_type')).toBe('code')
    // Without code=true Anthropic redirects instead of showing a code, and the
    // whole no-callback design falls apart.
    expect(url.searchParams.get('code')).toBe('true')
    expect(authId).toMatch(/^cauth-[A-Za-z0-9_-]+$/)
    expect(pending.verifier.length).toBeGreaterThan(40)
  })

  it('never puts the verifier in the url — that would undo PKCE', async () => {
    const { authorizeUrl, pending } = await startClaudeAuth()
    expect(authorizeUrl).not.toContain(pending.verifier)
    expect(new URL(authorizeUrl).searchParams.get('code_challenge')).not.toBe(pending.verifier)
  })

  it('is different every time', async () => {
    const a = await startClaudeAuth()
    const b = await startClaudeAuth()
    expect(a.pending.verifier).not.toBe(b.pending.verifier)
    expect(a.pending.state).not.toBe(b.pending.state)
    expect(a.authId).not.toBe(b.authId)
  })
})

describe('finishing sign-in', () => {
  const pending: PendingAuth = { verifier: 'v'.repeat(64), state: 'the-real-state', startedAt: 0 }

  it('rejects a code from a different sign-in', async () => {
    await expect(finishClaudeAuth('somecode#a-different-state', pending)).rejects.toThrow(OAuthError)
    await expect(finishClaudeAuth('somecode#a-different-state', pending)).rejects.toThrow(
      /different sign-in/,
    )
  })

  it('rejects a code with no state at all', async () => {
    await expect(finishClaudeAuth('justacode', pending)).rejects.toThrow(/different sign-in/)
  })

  it('rejects empty input with the one thing that fixes it', async () => {
    await expect(finishClaudeAuth('   ', pending)).rejects.toThrow(/incomplete/)
  })

  it('rejects a state that only shares a prefix', async () => {
    await expect(finishClaudeAuth('code#the-real', pending)).rejects.toThrow(/different sign-in/)
  })
})

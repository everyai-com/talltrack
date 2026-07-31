import { describe, expect, it } from 'vitest'
import {
  authorizeUrl,
  callbackUriFor,
  FIREFLIES_MCP_URL,
  FirefliesOAuthError,
} from '../src/ingest/fireflies-oauth'

describe('callback uri', () => {
  it('builds from the request origin so dev and prod both work', () => {
    expect(callbackUriFor('https://talltrack.everyai-com.workers.dev')).toBe(
      'https://talltrack.everyai-com.workers.dev/api/notetakers/fireflies/callback',
    )
    expect(callbackUriFor('http://localhost:8787')).toBe(
      'http://localhost:8787/api/notetakers/fireflies/callback',
    )
  })

  it('refuses plain http on the open internet', () => {
    expect(() => callbackUriFor('http://some-site.example')).toThrow(FirefliesOAuthError)
  })
})

describe('authorize url', () => {
  const url = new URL(authorizeUrl('client-1', 'https://x.example/cb', 'state-1', 'challenge-1'))

  it('points at fireflies with PKCE', () => {
    expect(url.origin + url.pathname).toBe('https://api.fireflies.ai/authorize')
    expect(url.searchParams.get('client_id')).toBe('client-1')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('state-1')
  })

  it('binds the grant to the MCP server via RFC 8707 resource', () => {
    // Without this the token that comes back is not valid for the only API we
    // call — the sign-in "succeeds" and every later request 401s.
    expect(url.searchParams.get('resource')).toBe(FIREFLIES_MCP_URL)
  })
})

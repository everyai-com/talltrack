import { describe, expect, it } from 'vitest'
import {
  claudeAuthHeaders,
  credentialHint,
  CredentialError,
  parseClaudeCredential,
} from '../src/providers/claude-credential'

const OAT = `sk-ant-oat01-${'a'.repeat(40)}`
const KEY = `sk-ant-api03-${'b'.repeat(40)}`

describe('parsing a pasted credential', () => {
  it('recognises a subscription token from claude setup-token', () => {
    expect(parseClaudeCredential(OAT)).toEqual({ kind: 'subscription', secret: OAT })
  })

  it('recognises a console api key', () => {
    expect(parseClaudeCredential(KEY)).toEqual({ kind: 'api_key', secret: KEY })
  })

  it('forgives the whitespace a terminal paste brings with it', () => {
    expect(parseClaudeCredential(`\n  ${OAT}  \n`).secret).toBe(OAT)
  })

  it('catches a token that was cut off mid-copy', () => {
    expect(() => parseClaudeCredential('sk-ant-oat01-short')).toThrow(CredentialError)
  })

  it('names the problem when the paste is a key for something else', () => {
    expect(() => parseClaudeCredential('sk-proj-abc123')).toThrow(/key for something else/)
  })

  it('rejects empty input with the one thing that fixes it', () => {
    expect(() => parseClaudeCredential('   ')).toThrow(/Paste the token/)
  })
})

describe('wire format', () => {
  // The whole reason `kind` is stored rather than re-guessed: sending one as
  // the other fails with a 401 that looks exactly like a revoked credential.
  it('sends a subscription token as a bearer token with the beta header', () => {
    const headers = claudeAuthHeaders({ kind: 'subscription', secret: OAT })
    expect(headers.authorization).toBe(`Bearer ${OAT}`)
    expect(headers['anthropic-beta']).toBe('oauth-2025-04-20')
    expect(headers['x-api-key']).toBeUndefined()
  })

  it('sends an api key as x-api-key with no bearer header', () => {
    const headers = claudeAuthHeaders({ kind: 'api_key', secret: KEY })
    expect(headers['x-api-key']).toBe(KEY)
    expect(headers.authorization).toBeUndefined()
  })
})

describe('what a screen may see', () => {
  it('exposes only the last four characters', () => {
    const hint = credentialHint({ kind: 'subscription', secret: OAT })
    expect(hint).toBe('…aaaa')
    expect(hint).not.toContain('oat01')
  })
})

import { describe, expect, it } from 'vitest'
import { claudeAuthHeaders } from '../src/providers/claude-credential'

const OAT = `sk-ant-oat01-${'a'.repeat(40)}`
const KEY = `sk-ant-api03-${'b'.repeat(40)}`

// The whole reason the kind is stored rather than re-derived: sending one as the
// other fails with a 401 indistinguishable from a revoked credential.
describe('wire format', () => {
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
    expect(headers['anthropic-beta']).toBeUndefined()
  })
})

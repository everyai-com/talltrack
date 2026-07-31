/**
 * How a Claude credential goes on the wire.
 *
 * Two kinds exist and they are NOT interchangeable. A subscription token — what
 * signing in with Claude returns, and what `claude setup-token` prints — goes in
 * an Authorization bearer header with an extra beta header. A console API key
 * goes in `x-api-key`. Sending one as the other returns a 401 that looks exactly
 * like a revoked credential, which is a miserable thing to debug, so the kind is
 * stored at connect time and never re-guessed at request time.
 */

export type ClaudeCredentialKind = 'subscription' | 'api_key'

export type ClaudeCredential = {
  kind: ClaudeCredentialKind
  secret: string
}

/** The one place the difference between the two kinds lives. */
export function claudeAuthHeaders(cred: ClaudeCredential): Record<string, string> {
  return cred.kind === 'subscription'
    ? {
        authorization: `Bearer ${cred.secret}`,
        // Without this the subscription token is rejected as an unknown credential.
        'anthropic-beta': 'oauth-2025-04-20',
      }
    : { 'x-api-key': cred.secret }
}

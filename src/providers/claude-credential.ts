/**
 * Claude credentials, in the two shapes that actually exist.
 *
 * `claude setup-token` — the same command AIOS runs — mints an OAuth token
 * (`sk-ant-oat01-…`) that bills the person's Claude subscription. An API key
 * (`sk-ant-api03-…`) bills their Anthropic console account instead.
 *
 * They are NOT interchangeable at the wire: an OAuth token goes in an
 * Authorization bearer header with an extra beta header, an API key goes in
 * x-api-key. Sending one as the other fails with a 401 that looks exactly like
 * a revoked credential, which is a miserable thing to debug — so the kind is
 * detected once, here, and carried explicitly from then on.
 *
 * How the token is CAPTURED is a separate question from how it is USED. AIOS
 * captures it by driving the CLI inside a container; TallTrack currently has
 * the person run one command and paste the result. Both produce this exact
 * credential, so the capture method can change later without touching anything
 * downstream of this file.
 */

export type ClaudeCredentialKind = 'subscription' | 'api_key'

export type ClaudeCredential = {
  kind: ClaudeCredentialKind
  secret: string
}

const OAUTH_PREFIX = 'sk-ant-oat01-'
const API_KEY_PREFIX = 'sk-ant-api'

export class CredentialError extends Error {}

/**
 * Recognise what was pasted. Deliberately strict about the prefixes and
 * deliberately generous about surrounding whitespace — people paste out of
 * terminals, and a trailing newline is not a user error.
 */
export function parseClaudeCredential(raw: string): ClaudeCredential {
  const secret = raw.trim()

  if (!secret) throw new CredentialError('Paste the token you got from the command above.')

  if (secret.startsWith(OAUTH_PREFIX)) {
    if (secret.length < OAUTH_PREFIX.length + 20)
      throw new CredentialError('That token looks cut off. Copy the whole line and try again.')
    return { kind: 'subscription', secret }
  }

  if (secret.startsWith(API_KEY_PREFIX)) return { kind: 'api_key', secret }

  if (secret.startsWith('sk-'))
    throw new CredentialError("That's a key for something else. Run the command above and paste what it prints.")

  throw new CredentialError("That doesn't look like a Claude token. Run the command above and paste the whole line.")
}

/** Headers for whichever kind this is. The one place the difference lives. */
export function claudeAuthHeaders(cred: ClaudeCredential): Record<string, string> {
  return cred.kind === 'subscription'
    ? {
        authorization: `Bearer ${cred.secret}`,
        // Without this the OAuth token is rejected as an unknown credential.
        'anthropic-beta': 'oauth-2025-04-20',
      }
    : { 'x-api-key': cred.secret }
}

/** Last four characters only — enough to recognise, useless if it leaks. */
export function credentialHint(cred: ClaudeCredential): string {
  return `…${cred.secret.slice(-4)}`
}

/**
 * The user's own Claude or Codex, behind one interface.
 *
 * Every run is billed to the person who connected it. TallTrack never falls
 * back to a platform key — not on error, not on rate limit, not "just for the
 * demo". That rule is what makes long-context writing affordable, and it is the
 * reason the architecture can stay simple (docs/PLAN.md §1).
 */

export type EngineName = 'claude' | 'codex'

export type EngineCredential = {
  engine: EngineName
  /** The user's own API credential, decrypted only in memory, never logged. */
  secret: string
  /** Optional pin. Absent means the adapter's current default. */
  model?: string
}

export type RunRequest = {
  system: string
  user: string
  /** Writing needs room; judging does not. */
  maxOutputTokens: number
  /**
   * Judges run near-deterministic so a verdict doesn't change between reruns
   * on identical input. The writer runs warm — a cold writer produces the
   * median sentence every time, which is exactly the failure mode here.
   */
  temperature: number
}

export type RunResult = {
  text: string
  /** What the provider actually served, not what we asked for. */
  model: string
  inputTokens: number
  outputTokens: number
}

export interface Engine {
  readonly name: EngineName
  run(req: RunRequest): Promise<RunResult>
}

/**
 * Failures a user can act on. The message is shown to a person, so it names the
 * one thing that fixes it and never carries a provider stack trace or any part
 * of the prompt (which contains their call transcripts).
 */
export class EngineError extends Error {
  constructor(
    readonly kind: 'auth' | 'rate_limit' | 'context_too_large' | 'unavailable' | 'bad_response',
    message: string,
  ) {
    super(message)
    this.name = 'EngineError'
  }
}

export function engineErrorFor(status: number, engine: EngineName): EngineError {
  const who = engine === 'claude' ? 'Claude' : 'Codex'
  if (status === 401 || status === 403)
    return new EngineError('auth', `Your ${who} connection isn't working. Reconnect it and try again.`)
  if (status === 429)
    return new EngineError('rate_limit', `Your ${who} account is rate limited right now. Try again in a few minutes.`)
  if (status === 413)
    return new EngineError('context_too_large', 'Too many calls at once. Try a shorter week.')
  return new EngineError('unavailable', `${who} didn't respond. Nothing was lost — try again.`)
}

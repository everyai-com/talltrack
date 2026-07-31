import { EngineError, engineErrorFor, type Engine, type EngineCredential, type RunRequest, type RunResult } from './types'

const API = 'https://api.anthropic.com/v1/messages'
const VERSION = '2023-06-01'

/**
 * Opus 5 for writing. The whole thesis is that a frontier model reading whole
 * transcripts beats a cheap model reading a summary, so this is not the place
 * to economise — and it isn't our bill.
 */
export const CLAUDE_DEFAULT_MODEL = 'claude-opus-5'

/** Judging is a narrower job than writing, and a faster model keeps the gate cheap. */
export const CLAUDE_JUDGE_MODEL = 'claude-sonnet-5'

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>
  model?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

export function claudeEngine(cred: EngineCredential): Engine {
  return {
    name: 'claude',
    async run(req: RunRequest): Promise<RunResult> {
      const res = await fetch(API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': cred.secret,
          'anthropic-version': VERSION,
        },
        body: JSON.stringify({
          model: cred.model ?? CLAUDE_DEFAULT_MODEL,
          max_tokens: req.maxOutputTokens,
          temperature: req.temperature,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
        }),
      })

      // Never surface the provider body: it echoes the request, and the request
      // is the user's call transcripts.
      if (!res.ok) throw engineErrorFor(res.status, 'claude')

      const body = (await res.json()) as AnthropicResponse
      const text = (body.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
        .trim()

      if (!text) throw new EngineError('bad_response', 'Claude returned nothing. Try again.')

      return {
        text,
        model: body.model ?? cred.model ?? CLAUDE_DEFAULT_MODEL,
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      }
    },
  }
}

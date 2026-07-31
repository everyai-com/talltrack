import { EngineError, engineErrorFor, type Engine, type EngineCredential, type RunRequest, type RunResult } from './types'
import { claudeAuthHeaders } from '../providers/claude-credential'

/**
 * Claude over the user's own credential. Four rules here were learned in
 * callcraft production, not from documentation:
 *
 * 1. A subscription token (sk-ant-oat) is SCOPED TO CLAUDE CODE. The backend
 *    expects the CLI identity as the first system block; our real system
 *    prompt rides as the second. Without it the call is rejected outright.
 * 2. Always stream. Long generations exceed the ~100s non-streaming edge
 *    timeout and die as 524s; SSE keeps the connection alive.
 * 3. Opus 5 thinks by DEFAULT and thinking spends max_tokens. A budget sized
 *    for the visible answer truncates it mid-stream — floor high; billing is
 *    subscription-flat so headroom is free.
 * 4. A plan tier that can't run Opus 400s — one in-flight downgrade to Sonnet,
 *    and one bounded retry-after wait on 429/529.
 */

const API = 'https://api.anthropic.com/v1/messages'
const VERSION = '2023-06-01'

export const CLAUDE_DEFAULT_MODEL = 'claude-opus-5'
export const CLAUDE_JUDGE_MODEL = 'claude-sonnet-5'
const WRITE_FALLBACK = 'claude-sonnet-5'

const CLI_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."

function budgetFor(model: string, requested: number): number {
  return model.includes('sonnet') || model.includes('opus') ? Math.max(requested, 40_000) : requested
}

type StreamOutcome = { text: string; inputTokens: number; outputTokens: number; sawStop: boolean }

/** Reassemble the text from an SSE Messages stream. */
export async function readMessageStream(body: ReadableStream<Uint8Array>): Promise<StreamOutcome> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let inputTokens = 0
  let outputTokens = 0
  let sawStop = false

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line.startsWith('data:')) continue

      let event: {
        type?: string
        delta?: { type?: string; text?: string }
        message?: { usage?: { input_tokens?: number } }
        usage?: { output_tokens?: number }
      }
      try {
        event = JSON.parse(line.slice(5).trim())
      } catch {
        continue
      }

      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') text += event.delta.text ?? ''
      if (event.type === 'message_start') inputTokens = event.message?.usage?.input_tokens ?? 0
      if (event.type === 'message_delta' && event.usage?.output_tokens) outputTokens = event.usage.output_tokens
      if (event.type === 'message_stop') sawStop = true
      if (event.type === 'error') throw new EngineError('unavailable', "Claude cut out mid-write. Nothing was lost — try again.")
    }
  }

  return { text: text.trim(), inputTokens, outputTokens, sawStop }
}

export function claudeEngine(cred: EngineCredential): Engine {
  return {
    name: 'claude',
    async run(req: RunRequest): Promise<RunResult> {
      const subscription = (cred.kind ?? 'api_key') === 'subscription'
      let model = cred.model ?? CLAUDE_DEFAULT_MODEL

      const attempt = (m: string) =>
        fetch(API, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'anthropic-version': VERSION,
            ...claudeAuthHeaders({ kind: cred.kind ?? 'api_key', secret: cred.secret }),
          },
          body: JSON.stringify({
            model: m,
            max_tokens: budgetFor(m, req.maxOutputTokens),
            // No temperature, ever: Claude 5 reasoning models 400 on it
            // ("`temperature` is deprecated for this model"). The judge's
            // near-determinism now rests on its strict prompt and bands, not
            // on sampling — recorded in docs/DECISIONS.md.
            stream: true,
            system: subscription
              ? [
                  { type: 'text', text: CLI_IDENTITY },
                  { type: 'text', text: req.system },
                ]
              : req.system,
            messages: [{ role: 'user', content: req.user }],
          }),
        })

      let res = await attempt(model)

      // Plan tier can't run Opus → same call again on Sonnet.
      if (!res.ok && model.includes('opus') && [400, 403, 404].includes(res.status)) {
        model = WRITE_FALLBACK
        res = await attempt(model)
      }

      // Subscription plans rate-limit hard; honor one bounded retry-after.
      if (res.status === 429 || res.status === 529) {
        const wait = Math.min(Number(res.headers.get('retry-after')) || 5, 30)
        await new Promise((resolve) => setTimeout(resolve, wait * 1000))
        res = await attempt(model)
      }

      // Never surface the provider body: it echoes the request, and the
      // request is the user's call transcripts.
      if (!res.ok || !res.body) throw engineErrorFor(res.status, 'claude')

      const stream = await readMessageStream(res.body)
      // A stream that ends without message_stop was cut — treating the partial
      // text as an answer would hand a truncated post to the judge.
      if (!stream.sawStop || !stream.text)
        throw new EngineError('unavailable', "Claude cut out mid-write. Nothing was lost — try again.")

      return { text: stream.text, model, inputTokens: stream.inputTokens, outputTokens: stream.outputTokens }
    },
  }
}

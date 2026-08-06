import { EngineError, engineErrorFor, type Engine, type EngineCredential, type RunRequest, type RunResult } from './types.ts'

const API = 'https://api.openai.com/v1/responses'

export const CODEX_DEFAULT_MODEL = 'gpt-5.6'
export const CODEX_JUDGE_MODEL = 'gpt-5.5'

type ResponsesBody = {
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
  output_text?: string | string[]
  model?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

/** The Responses API returns text in more than one shape depending on the model. */
function extractText(body: ResponsesBody): string {
  if (typeof body.output_text === 'string' && body.output_text.trim()) return body.output_text.trim()
  if (Array.isArray(body.output_text)) {
    const joined = body.output_text.join('').trim()
    if (joined) return joined
  }
  return (body.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' || part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
    .trim()
}

export function codexEngine(cred: EngineCredential): Engine {
  return {
    name: 'codex',
    async run(req: RunRequest): Promise<RunResult> {
      const res = await fetch(API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cred.secret}`,
        },
        body: JSON.stringify({
          model: cred.model ?? CODEX_DEFAULT_MODEL,
          max_output_tokens: req.maxOutputTokens,
          temperature: req.temperature,
          instructions: req.system,
          input: req.user,
        }),
      })

      if (!res.ok) throw engineErrorFor(res.status, 'codex')

      const body = (await res.json()) as ResponsesBody
      const text = extractText(body)
      if (!text) throw new EngineError('bad_response', 'Codex returned nothing. Try again.')

      return {
        text,
        model: body.model ?? cred.model ?? CODEX_DEFAULT_MODEL,
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      }
    },
  }
}

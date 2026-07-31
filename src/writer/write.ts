import type { Engine } from '../engine'
import { CONSTITUTION, MIN_VOICE_EXAMPLES, VOICE_PREAMBLE } from './constitution'

export type CallInput = {
  id: string
  title: string
  occurredAt: string
  /** The whole thing. Never a summary, never an extract. */
  transcript: string
}

export type WriteContext = {
  /** Posts this person actually published, for voice. Facts are never taken from these. */
  publishedExamples?: string[]
  /** Who they sell to, in their own words. Shapes who the stranger test judges for. */
  audience?: string
}

export type Draft = {
  /** The post, ready to paste. */
  body: string
  /** The single tension, in one sentence. Its absence is what makes a post impossible. */
  tension: string
  /** Which calls it came from — for the quote check and for showing provenance. */
  callIds: string[]
}

export type WriteResult = {
  drafts: Draft[]
  /** Present when the honest answer is zero. Shown to the user, in these words. */
  nothingBecause?: string
  model: string
  inputTokens: number
  outputTokens: number
}

/** Enough room to think and to write three posts; not enough to ramble. */
const MAX_OUTPUT_TOKENS = 8000

/**
 * Warm on purpose. A cold writer returns the median sentence, and the median
 * sentence is exactly what makes callcraft's output forgettable.
 */
const TEMPERATURE = 1

/** Hard ceiling on how many posts a week can produce. Volume is the enemy. */
export const MAX_DRAFTS = 3

const OUTPUT_CONTRACT = `============================================================
HOW TO RETURN YOUR WORK
============================================================
Think as long as you need to first — read the calls, look for the tension,
consider what to leave out. Then return ONLY a JSON object, with no prose
before or after it and no code fence:

{
  "drafts": [
    {
      "tension": "the one-sentence tension this post is built on",
      "body": "the post itself, ready to paste, with real line breaks",
      "call_ids": ["the ids of the calls this came from"]
    }
  ],
  "nothing_because": null
}

At most ${MAX_DRAFTS} drafts, and fewer is usually right. One excellent post
beats three good ones, and the person reading this has to choose what to
publish — every extra draft is work you handed back to them.

If there is no post in this material, return:

{ "drafts": [], "nothing_because": "one plain sentence saying what these calls were, and what would have made a post" }

That is a real answer. Use it whenever it is true.`

function renderCalls(calls: CallInput[]): string {
  return calls
    .map(
      (call) => `<call id="${call.id}" title="${escapeAttr(call.title)}" date="${call.occurredAt}">
${call.transcript}
</call>`,
    )
    .join('\n\n')
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "'").replace(/[<>]/g, '')
}

export function buildWritePrompt(calls: CallInput[], ctx: WriteContext = {}): { system: string; user: string } {
  const parts: string[] = [CONSTITUTION]

  const examples = ctx.publishedExamples ?? []
  if (examples.length >= MIN_VOICE_EXAMPLES) {
    parts.push(
      `${VOICE_PREAMBLE}\n\n${examples.map((post, i) => `--- published post ${i + 1} ---\n${post}`).join('\n\n')}`,
    )
  }

  if (ctx.audience?.trim()) {
    parts.push(
      `============================================================\nWHO THEY ARE WRITING FOR\n============================================================\n${ctx.audience.trim()}\n\nThis is who the stranger is. Judge relevance against this person.`,
    )
  }

  parts.push(OUTPUT_CONTRACT)

  return {
    system: parts.join('\n\n'),
    user: `Here are the calls. Read all of them before you write.\n\n${renderCalls(calls)}`,
  }
}

/**
 * Everything between the first { and the last }. Models sometimes wrap JSON in
 * a fence or add a sentence in front of it; that is a formatting slip, not a
 * failed run, and re-running a long-context write over it would be expensive
 * and wasteful.
 */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no_json')
  return JSON.parse(text.slice(start, end + 1))
}

type RawDraft = { tension?: unknown; body?: unknown; call_ids?: unknown }

export function parseWriteResponse(text: string): { drafts: Draft[]; nothingBecause?: string } {
  const parsed = extractJson(text) as { drafts?: unknown; nothing_because?: unknown }

  const drafts: Draft[] = (Array.isArray(parsed.drafts) ? parsed.drafts : [])
    .map((raw: RawDraft) => ({
      body: typeof raw.body === 'string' ? raw.body.trim() : '',
      tension: typeof raw.tension === 'string' ? raw.tension.trim() : '',
      callIds: Array.isArray(raw.call_ids) ? raw.call_ids.filter((id): id is string => typeof id === 'string') : [],
    }))
    // A draft with no body or no stated tension is not a draft. Law 2 is not
    // decoration: if the writer could not name the tension, it did not find one.
    .filter((d) => d.body.length > 0 && d.tension.length > 0)
    .slice(0, MAX_DRAFTS)

  const nothingBecause =
    typeof parsed.nothing_because === 'string' && parsed.nothing_because.trim()
      ? parsed.nothing_because.trim()
      : undefined

  return { drafts, nothingBecause }
}

export async function write(engine: Engine, calls: CallInput[], ctx: WriteContext = {}): Promise<WriteResult> {
  if (calls.length === 0) {
    return { drafts: [], nothingBecause: 'No calls this week.', model: '', inputTokens: 0, outputTokens: 0 }
  }

  const { system, user } = buildWritePrompt(calls, ctx)
  const res = await engine.run({ system, user, maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: TEMPERATURE })
  const { drafts, nothingBecause } = parseWriteResponse(res.text)

  return {
    drafts,
    // Zero drafts always carries a reason, even when the writer forgot to give
    // one. A silent empty week reads as a broken product.
    nothingBecause:
      drafts.length === 0
        ? (nothingBecause ?? 'Nothing in these calls carried a story worth publishing.')
        : undefined,
    model: res.model,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
  }
}

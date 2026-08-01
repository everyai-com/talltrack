import type { Engine } from '../engine'
import { CONSTITUTION, MIN_VOICE_EXAMPLES, VOICE_PREAMBLE } from './constitution'
import { WRITING_STYLE } from './style'
import { FOUNDER_EXEMPLAR, LINKEDIN_TEMPLATE_LIBRARY, TEMPLATE_LOCK } from './references'

/**
 * The writer, in phases — the shape AIOS actually writes in.
 *
 * The first version did everything in one call and returned prose inside a
 * JSON contract. Two problems, both learned the expensive way: a model asked
 * to fill a JSON string writes in a flatter register than one asked to write,
 * and a single call splitting attention across three posts gives each a third
 * of it. callcraft's founder said it plainly: "AI needs to think in phases."
 *
 * Phase 1 — FIND: read everything, name the 0–3 tensions worth a post. JSON,
 *           because this phase's output is data.
 * Phase 2 — WRITE: one call PER post. Full attention, whole transcripts in
 *           context, and the output is the post itself. No JSON anywhere near
 *           the prose.
 * Phase 3 — CUT: the editor's pass on each draft. Start later, end earlier,
 *           cut what the material doesn't pay for.
 *
 * The judge stays downstream and separate (drop, never revise). Extra calls
 * cost nothing marginal — the subscription is flat, and quality is the product.
 */

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

/** Hard ceiling on how many posts a week can produce. Volume is the enemy. */
export const MAX_DRAFTS = 3

// ─── Phase 1: find ───────────────────────────────────────────────────────────

const FIND_SYSTEM = `${CONSTITUTION}

============================================================
YOUR JOB RIGHT NOW: FIND, DON'T WRITE
============================================================
Read every transcript in full. Then name the tensions worth a post — at most
${MAX_DRAFTS}, and fewer is usually right. Do not write the posts yet.

Return ONLY JSON, no prose and no code fence:

{
  "stories": [
    {
      "tension": "the one-sentence tension",
      "call_ids": ["the calls that carry it"],
      "material": "one sentence on the concrete material that funds it — the scene, the number, the quote"
    }
  ],
  "nothing_because": null
}

If nothing here deserves a post, return:
{ "stories": [], "nothing_because": "one plain sentence saying what these calls were and what would have made a post" }

That is a real answer. Use it whenever it is true.`

export type Story = { tension: string; callIds: string[]; material: string }

export function parseStories(text: string): { stories: Story[]; nothingBecause?: string } {
  const parsed = extractJson(text) as { stories?: unknown; nothing_because?: unknown }
  const stories: Story[] = (Array.isArray(parsed.stories) ? parsed.stories : [])
    .map((raw: { tension?: unknown; call_ids?: unknown; material?: unknown }) => ({
      tension: typeof raw.tension === 'string' ? raw.tension.trim() : '',
      callIds: Array.isArray(raw.call_ids) ? raw.call_ids.filter((v): v is string => typeof v === 'string') : [],
      material: typeof raw.material === 'string' ? raw.material.trim() : '',
    }))
    .filter((s) => s.tension.length > 0)
    .slice(0, MAX_DRAFTS)

  const nothingBecause =
    typeof parsed.nothing_because === 'string' && parsed.nothing_because.trim()
      ? parsed.nothing_because.trim()
      : undefined

  return { stories, nothingBecause }
}

// ─── Phase 2: write one post, as prose ───────────────────────────────────────

function writeSystem(ctx: WriteContext): string {
  const parts = [CONSTITUTION, WRITING_STYLE, FOUNDER_EXEMPLAR, TEMPLATE_LOCK, LINKEDIN_TEMPLATE_LIBRARY]

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

  parts.push(`============================================================
YOUR JOB RIGHT NOW: WRITE ONE POST
============================================================
You will be given the transcripts and ONE tension. Write the one post that
tension deserves. All of your attention on this single post.

QUOTATION MARKS ARE A VERBATIM CLAIM. Text inside quote marks must appear in
the transcript word for word — an ellipsis may elide a middle, nothing else may
change. When you want to render what someone said and you don't have their
exact words, write it as paraphrase WITHOUT quote marks: he told me the mistake
was mine — not "the mistake was yours". The reference posts quote freely;
their quotes were theirs to make. Yours must be real.

Return ONLY the post itself — the exact text the person will paste. No JSON,
no preamble, no commentary, no "Here's the post", no title line, no fences.
The first line of your reply is the first line of the post.`)

  return parts.join('\n\n')
}

// ─── Phase 3: the cut ────────────────────────────────────────────────────────

const CUT_SYSTEM = `${WRITING_STYLE}

============================================================
YOUR JOB RIGHT NOW: THE EDITOR'S CUT
============================================================
You are the editor reading a finished draft. Make it tighter and truer without
adding a single new fact.

- Start later. If the post warms up before it begins, cut the warm-up.
- End earlier. If the last lines restate what the reader already got, cut them.
- Cut every line the material doesn't pay for — transitions, hedges, second
  examples that prove the same point, anything that only sounds good.
- Keep every quotation byte-for-byte or remove its quote marks. Never reword
  text inside quotation marks. If you suspect a quote is a paraphrase wearing
  quote marks, strip the marks and keep the line — a paraphrase is honest, a
  fake quote is not.
- Add nothing. No new facts, numbers, names, or claims. This is a cut, not a
  rewrite.
- If the draft is already tight, change little. A light hand is a valid edit.

Return ONLY the final post text. No commentary, no fences. The first line of
your reply is the first line of the post.`

/** Strip the wrappers models sometimes add around prose they were told not to wrap. */
export function cleanPost(text: string): string {
  let out = text.trim()
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/.exec(out)
  if (fence?.[1]) out = fence[1].trim()
  out = out.replace(/^(?:here(?:'|’)s the post:?|final post:?|post:)\s*/i, '')
  return out.trim()
}

// ─── The phases, assembled ───────────────────────────────────────────────────

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

export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no_json')
  return JSON.parse(text.slice(start, end + 1))
}

export async function write(engine: Engine, calls: CallInput[], ctx: WriteContext = {}): Promise<WriteResult> {
  if (calls.length === 0) {
    return { drafts: [], nothingBecause: 'No calls this week.', model: '', inputTokens: 0, outputTokens: 0 }
  }

  const transcripts = `Here are the calls. Read all of them before anything else.\n\n${renderCalls(calls)}`
  let inputTokens = 0
  let outputTokens = 0
  let model = ''

  const track = (res: { model: string; inputTokens: number; outputTokens: number }) => {
    model = res.model
    inputTokens += res.inputTokens
    outputTokens += res.outputTokens
  }

  // Phase 1 — find.
  const found = await engine.run({ system: FIND_SYSTEM, user: transcripts, maxOutputTokens: 2000, temperature: 1 })
  track(found)
  const { stories, nothingBecause } = parseStories(found.text)

  if (stories.length === 0) {
    return {
      drafts: [],
      nothingBecause: nothingBecause ?? 'Nothing in these calls carried a story worth publishing.',
      model,
      inputTokens,
      outputTokens,
    }
  }

  // Phases 2 and 3 — one post at a time, full attention each. Sequential on
  // purpose: subscriptions rate-limit hard, and parallel long-context calls
  // are exactly what trips it.
  const drafts: Draft[] = []
  const system = writeSystem(ctx)

  for (const story of stories) {
    try {
      const drafted = await engine.run({
        system,
        user: `${transcripts}\n\n============================================================\nTHE TENSION FOR THIS POST\n============================================================\n${story.tension}\n\nThe material that funds it: ${story.material}\n\nWrite the post.`,
        maxOutputTokens: 2000,
        temperature: 1,
      })
      track(drafted)

      const cut = await engine.run({
        system: CUT_SYSTEM,
        user: cleanPost(drafted.text),
        maxOutputTokens: 2000,
        temperature: 1,
      })
      track(cut)

      const body = cleanPost(cut.text)
      if (body.length > 0) drafts.push({ body, tension: story.tension, callIds: story.callIds })
    } catch {
      // One story failing must not take the others down — same rule as the
      // judge. The story is skipped, not retried; a retry loop is how packs
      // of mediocrity get made.
    }
  }

  return {
    drafts,
    nothingBecause:
      drafts.length === 0 ? 'The writing didn’t survive its own edit this week. The calls are still here — try again.' : undefined,
    model,
    inputTokens,
    outputTokens,
  }
}

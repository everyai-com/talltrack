import type { Engine } from '../engine/index.ts'
import { CONSTITUTION, MIN_VOICE_EXAMPLES, VOICE_PREAMBLE } from './constitution.ts'
import { AIOS_LINKEDIN_GUIDE } from './aios-guide.ts'
import { WRITING_STYLE } from './style.ts'
import { FOUNDER_EXEMPLAR } from './references.ts'
import { SHAPE_LIBRARY } from './shape-library.generated.ts'

/**
 * The writer reads the whole window once, writes the strongest zero-to-three
 * posts in prose, and returns them to the separate judge. This is deliberately
 * one pass: Callcraft's multi-stage compression and rewrite loop produced
 * competent, repetitive copy. The user's own engine has enough context for the
 * source material to stay whole.
 */

export type CallInput = {
  id: string
  source?: string
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
  /** Opt-in evaluation-only candidate count. Normal product runs stay at three. */
  candidateLimit?: number
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

/** Default ceiling on how many posts a week can produce. Volume is the enemy. */
export const MAX_DRAFTS = 3
/** A bounded, explicit evaluation override for comparing a larger candidate set. */
export const MAX_EVALUATION_DRAFTS = 5

/**
 * The single editorial context shared by the in-app writer and MCP. Keeping
 * this exported makes it possible to regression-test that both surfaces carry
 * the same AIOS writing bar, examples, and learned audience.
 */
/**
 * The physical shape that performs, measured across the top 300 posts (by
 * likes) of the 3,152-post ACX creator corpus — not guessed. The founder's
 * 2026-08-06 direction: the writer produced prose essays while every
 * high-performing reference (including his own exemplar) is built in mobile
 * blocks, so the shape is now stated as law at every level.
 */
export const SHAPE_LAW = `============================================================
THE SHAPE THAT PERFORMS (measured on 3,152 posts, not guessed)
============================================================
Across the 300 highest-engagement posts in the reference corpus:

- The hook is ONE line, median 44 characters. Keep it under 60. A number
  in the hook when the material has one.
- 91% of all lines are under 60 characters. Write in mobile blocks of
  1-3 short lines with blank lines between them. A paragraph longer
  than 3 phone lines is a wall; break it or cut it.
- Half the posts carry a numbered or arrow stack. When the material has
  steps, receipts, or a list of facts, stack them one per line.
- Around 1,400 characters total, laid out as 25-35 short lines — never
  6 dense paragraphs.
- The last line is one short sentence that lands.

Default to this shape for everything. A genuinely lived story may run its
lines a little longer, but even then paragraphs stay at 1-3 mobile lines.`

/** The library rendered with its lock. Structure travels; words never do. */
function renderShapeLibrary(): string {
  const posts = SHAPE_LIBRARY.map(
    (r, i) => `--- shape reference ${i + 1} (${r.creator}, ${r.likes.toLocaleString()} likes) ---\n${r.body}`,
  ).join('\n\n')
  return `============================================================
SHAPE REFERENCES — STRUCTURE ONLY
============================================================
${SHAPE_LIBRARY.length} of the highest-engagement posts from the corpus. Study how they are
BUILT: the one-line hook, the short-line rhythm, the stacks, the landing.

The lock: nothing else transfers. Their facts, numbers, names, offers,
tools, hooks, CTAs, hashtags and phrases were theirs to use — yours come
from the transcripts or not at all. Where a reference uses language the
style law bans (hype, hashtags, comment-farming closers), the style law
wins: copy the skeleton, never the skin.

${posts}`
}

export function buildEditorialContext(ctx: WriteContext = {}): string {
  const parts = [
    CONSTITUTION,
    WRITING_STYLE,
    AIOS_LINKEDIN_GUIDE,
    SHAPE_LAW,
    FOUNDER_EXEMPLAR,
    renderShapeLibrary(),
  ]

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

  return parts.join('\n\n')
}

function writeSystem(ctx: WriteContext, maxDrafts: number): string {
  return `${buildEditorialContext(ctx)}

============================================================
YOUR JOB RIGHT NOW: WRITE THE BEST POSTS THIS WINDOW EARNS
============================================================
Read every transcript in the user message before deciding. Write zero to
${maxDrafts} posts. Fewer is usually right. The first post must be the strongest
one. Add another only when it has a genuinely different tension and the calls
support it; never make variants of the same idea just to fill the quota.

Do the editorial thinking silently. The body of each post must not be a
summary, outline, framework, or transcript recap. Build it in the measured
shape: one-line hook under 60 characters, mobile blocks of 1-3 short lines,
stacks for receipts, a short last line that lands. No CTA, no question
ending, no padding to a word count — the shape is the container, the
transcripts are the only content.

QUOTATION MARKS ARE A VERBATIM CLAIM. Text inside quote marks must appear in
the transcript word for word — an ellipsis may elide a middle, nothing else may
change. When you want to render what someone said and you don't have their
exact words, write it as paraphrase WITHOUT quote marks: he told me the mistake
was mine — not "the mistake was yours". Yours must be real.

Return ONLY the tagged contract below. Do not return JSON. Do not put any
headings inside a post body. The text between BODY and </post> is paste-ready.

<post>
TENSION: one plain sentence naming the tension
CALLS: exact call ids separated by commas
BODY:
the exact text the person will paste
</post>

If there is no post, return only:
<nothing>one plain sentence explaining why these calls do not earn a post</nothing>`
}

/** Strip the wrappers models sometimes add around prose they were told not to wrap. */
export function cleanPost(text: string): string {
  let out = text.trim()
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/.exec(out)
  if (fence?.[1]) out = fence[1].trim()
  out = out.replace(/^(?:here(?:'|’)s the post:?|final post:?|post:)\s*/i, '')
  return out.trim()
}

export type ParsedDraft = Pick<Draft, 'body' | 'tension' | 'callIds'>

/**
 * Parse the one-pass prose contract. The body is deliberately outside JSON so
 * the model is not forced to write prose in a data register.
 */
export function parseDrafts(text: string, limit = MAX_DRAFTS): { drafts: ParsedDraft[]; nothingBecause?: string } {
  const nothing = /<nothing>\s*([\s\S]*?)\s*<\/nothing>/iu.exec(text)?.[1]?.trim()
  const drafts: ParsedDraft[] = []
  const blocks = text.matchAll(/<post\b[^>]*>([\s\S]*?)<\/post>/giu)
  const max = Math.min(MAX_EVALUATION_DRAFTS, Math.max(1, Math.floor(limit)))

  for (const match of blocks) {
    if (drafts.length >= max) break
    const block = match[1] ?? ''
    const tension = /^\s*tension\s*:\s*(.+?)\s*$/imu.exec(block)?.[1]?.trim() ?? ''
    const callsText = /^\s*calls?\s*:\s*(.+?)\s*$/imu.exec(block)?.[1]?.trim() ?? ''
    const bodyMatch = /^\s*body\s*:\s*\n([\s\S]*)$/imu.exec(block)
    const body = bodyMatch?.[1] ? cleanPost(bodyMatch[1]) : ''
    const callIds = callsText
      .split(/[,\n]/u)
      .map((id) => id.trim())
      .filter(Boolean)

    if (tension && body && callIds.length > 0) drafts.push({ body, tension, callIds })
  }

  return { drafts, nothingBecause: nothing || undefined }
}

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

/** Kept for profile JSON parsing; writer output itself is intentionally not JSON. */
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

  const limit = Math.min(MAX_EVALUATION_DRAFTS, Math.max(1, Math.floor(ctx.candidateLimit ?? MAX_DRAFTS)))
  const transcripts = `Here are the calls. Read all of them before anything else.\n\n${renderCalls(calls)}`
  const written = await engine.run({
    system: writeSystem(ctx, limit),
    user: transcripts,
    maxOutputTokens: 2400,
    temperature: 1,
  })

  const parsed = parseDrafts(written.text, limit)
  const knownCallIds = new Set(calls.map((call) => call.id))
  const drafts: Draft[] = parsed.drafts
    .map((draft) => ({
      ...draft,
      callIds: draft.callIds.filter((id) => knownCallIds.has(id)),
    }))
    .filter((draft) => draft.callIds.length > 0)

  return {
    drafts,
    nothingBecause: drafts.length === 0 ? parsed.nothingBecause ?? 'Nothing in these calls carried a story worth publishing.' : undefined,
    model: written.model,
    inputTokens: written.inputTokens,
    outputTokens: written.outputTokens,
  }
}

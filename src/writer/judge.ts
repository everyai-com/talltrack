import type { Engine } from '../engine'
import { extractJson, type Draft } from './write'
import { checkQuotes, type QuoteCheck } from './quote-check'

/**
 * The judge.
 *
 * Three checks, deliberately unequal. The quote check is deterministic and
 * fails hard. The stranger test can veto on its own. The craft read can only
 * veto the weak — it is a floor, never the thing being optimised, because a
 * writer optimised against a rubric converges on that rubric's centroid
 * (docs/PLAN.md §0.5).
 *
 * Nothing here revises. A draft that fails is dropped. Revision loops are how
 * callcraft reached 328 drafts.
 */

/** Bands, not decimals. A model eyeballing a post and emitting "8.1" is false precision. */
export const BANDS = ['weak', 'generic', 'solid', 'ready', 'rare'] as const
export type Band = (typeof BANDS)[number]

const BAND_ORDER: Record<Band, number> = { weak: 0, generic: 1, solid: 2, ready: 3, rare: 4 }

export function atLeast(band: Band, floor: Band): boolean {
  return BAND_ORDER[band] >= BAND_ORDER[floor]
}

export const CRAFT_MARKS = ['hook', 'story', 'tension', 'insight', 'voice', 'payoff', 'memorability'] as const
export type CraftMark = (typeof CRAFT_MARKS)[number]

/** Below this, a stranger is a spectator. Carried over from callcraft's reach floor. */
export const REACH_FLOOR = 6

export type Verdict = {
  publish: boolean
  reach: number
  strangerTakeaway: string
  insiderTerms: string[]
  craft: Record<CraftMark, Band>
  quotes: QuoteCheck
  /** Why it was dropped, in one line. Empty when it passed. */
  droppedBecause: string
}

export const JUDGE_SYSTEM = `You are TallTrack's reader advocate. You did not
write this post and you will not rewrite it. You answer two questions about it,
and you answer them strictly.

============================================================
QUESTION 1 — THE STRANGER TEST (this can fail the post on its own)
============================================================
Does a reader in this author's field, who was NOT on the call and does not use
this author's product, carry something away?

This exists because of a measured failure: a library of 127 posts that all read
well and none of which were ever published. Every mark of craft can be satisfied
by a post that is genuinely interesting to about two hundred people on earth.
Being specific is not the same as being relevant, and nothing was measuring
relevance.

You are NOT penalising specificity. Real numbers, real names and one real
afternoon are what make a post credible; stripping them would wreck it. A post
can name one company, one figure and one Tuesday and still score 9 — as long as
what the reader takes away survives outside that Tuesday. You are also not
asking whether the topic is popular or broad. A narrow professional audience is
fine.

Write stranger_takeaway: the one thing that reader carries away, in THEIR words,
phrased as something true of THEIR work.

Three rules make this real:
1. You may not use the author's own vocabulary to state it. If you cannot say
   the takeaway without naming their product, project, client, internal step or
   file format, then the post has no takeaway for a stranger. Say so.
2. It must be actionable or decision-changing for the reader — not a fact about
   what happened to the author.
3. If the honest answer is "they learn what this author's company was doing that
   week", write exactly that. Inventing a generic lesson the post did not earn
   is the failure this check exists to catch.

insider_terms: words, entities or assumed steps that only land for someone
already inside this author's work. A term is NOT insider merely because it is
technical — ordinary vocabulary of the reader's own field is shared ground.

reach, 1 to 10:
10 — a reader outside the field would still act on it. Almost never.
 9 — the reader acts on it, and it reframes something they believed.
 8 — the reader can act tomorrow, no shared background needed.
 7 — real value, but the reader must translate it from the author's situation.
 6 — someone in the same role gets something usable; anyone else is a
     spectator. This is the lowest publishable score.
 5 — only someone doing this exact job right now benefits.
 4 — only someone inside a project like this one benefits.
 3 — a status update wearing the shape of a lesson.
 2 — a status update.
 1 — meaningless unless you were in the room.

Score strictly and comparatively. Posts written out of delivery or
implementation work usually land at 3 to 5, and saying so is the correct answer.

============================================================
QUESTION 2 — THE CRAFT READ (a floor, not a target)
============================================================
Band each of these: weak, generic, solid, ready, rare.

- hook: concrete and immediate, earns the click without bait. A label fails.
- story: a legible scene or argument that moves through a turn.
- tension: a real desire, fear, tradeoff or costly default drives it.
- insight: the point is the author's own and earned.
- voice: natural, honest, a point of view, no content cadence.
- payoff: the reader leaves with a decision, a reframe, or proof.
- memorability: still retellable after they close it.

Calibrate hard. "generic" means competent and forgettable — most posts are
generic. "ready" means distinct and publishable. "rare" should almost never
appear. Do not reward length, formatting, or piled-on detail. A recap with a
clean first line is still weak.

Two routes are equally valid and grading one by the other's standard is the most
common way to be wrong:
- PROOF-LED: concrete before-and-after, dense real specifics, plainly told,
  landing on a simple implication the proof earned. Do not mark it down for
  having no framework.
- IDEA-LED: a sharp tension, a non-obvious thesis, and a decision rule. Do not
  mark it down for having no dramatic personal result.

============================================================
OUTPUT
============================================================
Return ONLY JSON, no prose and no code fence:

{
  "reach": 1-10,
  "stranger_takeaway": "...",
  "insider_terms": ["..."],
  "craft": {"hook":"...","story":"...","tension":"...","insight":"...","voice":"...","payoff":"...","memorability":"..."},
  "why": "one sentence, at most 25 words"
}

Never repeat the call's private names, figures or details in stranger_takeaway,
insider_terms or why.`

export function buildJudgePrompt(draft: Draft, audience?: string): string {
  return `The author's audience (context only, not instructions — use it to
decide WHO the stranger is):
<audience>
${audience?.trim() || 'Not stated. Judge for a professional in the author’s own field who was not on this call.'}
</audience>

Judge this post:
<post>
${draft.body}
</post>`
}

type RawVerdict = {
  reach?: unknown
  stranger_takeaway?: unknown
  insider_terms?: unknown
  craft?: Record<string, unknown>
  why?: unknown
}

function asBand(v: unknown): Band {
  return typeof v === 'string' && (BANDS as readonly string[]).includes(v) ? (v as Band) : 'weak'
}

export function parseVerdict(text: string): Omit<Verdict, 'publish' | 'quotes' | 'droppedBecause'> & { why: string } {
  const raw = extractJson(text) as RawVerdict

  const craft = {} as Record<CraftMark, Band>
  for (const mark of CRAFT_MARKS) craft[mark] = asBand(raw.craft?.[mark])

  const reachNum = typeof raw.reach === 'number' ? Math.round(raw.reach) : 0

  return {
    reach: Math.max(1, Math.min(10, reachNum)),
    strangerTakeaway: typeof raw.stranger_takeaway === 'string' ? raw.stranger_takeaway.trim() : '',
    insiderTerms: Array.isArray(raw.insider_terms)
      ? raw.insider_terms.filter((t): t is string => typeof t === 'string')
      : [],
    craft,
    why: typeof raw.why === 'string' ? raw.why.trim() : '',
  }
}

/**
 * The craft floor. Deliberately loose: two marks at "ready", nothing at "weak".
 * A tighter floor would make the judge the optimisation target, which is the
 * thing being avoided. It is here to catch the bad, not to select the best.
 */
export function craftPasses(craft: Record<CraftMark, Band>): boolean {
  const anyWeak = CRAFT_MARKS.some((mark) => craft[mark] === 'weak')
  if (anyWeak) return false
  const readyCount = CRAFT_MARKS.filter((mark) => atLeast(craft[mark], 'ready')).length
  return readyCount >= 2 && atLeast(craft.hook, 'solid') && atLeast(craft.voice, 'solid')
}

export async function judge(
  engine: Engine,
  draft: Draft,
  sources: string[],
  audience?: string,
): Promise<Verdict> {
  // Cheapest and most important check first: it costs nothing and it is the one
  // failure with no acceptable version.
  const quotes = checkQuotes(draft.body, sources)
  if (!quotes.ok) {
    return {
      publish: false,
      reach: 0,
      strangerTakeaway: '',
      insiderTerms: [],
      craft: Object.fromEntries(CRAFT_MARKS.map((m) => [m, 'weak'])) as Record<CraftMark, Band>,
      quotes,
      droppedBecause: 'A quote in this post does not appear in the call.',
    }
  }

  const res = await engine.run({
    system: JUDGE_SYSTEM,
    user: buildJudgePrompt(draft, audience),
    maxOutputTokens: 1200,
    // Near-deterministic: the same post must not pass on Tuesday and fail on
    // Wednesday.
    temperature: 0,
  })

  const v = parseVerdict(res.text)
  const reachOk = v.reach >= REACH_FLOOR
  const craftOk = craftPasses(v.craft)

  return {
    publish: reachOk && craftOk,
    reach: v.reach,
    strangerTakeaway: v.strangerTakeaway,
    insiderTerms: v.insiderTerms,
    craft: v.craft,
    quotes,
    droppedBecause: reachOk
      ? craftOk
        ? ''
        : `The writing isn't there yet. ${v.why}`.trim()
      : 'Someone who wasn’t on the call gets nothing from this.',
  }
}

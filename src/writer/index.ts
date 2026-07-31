import type { Engine, EngineCredential } from '../engine'
import { engineFor, judgeEngineFor } from '../engine'
import { write, type CallInput, type Draft, type WriteContext } from './write'
import { checkQuotes, dequoteUnmatched } from './quote-check'
import { judge, CRAFT_MARKS, type Verdict } from './judge'

export * from './write'
export * from './judge'
export * from './quote-check'
export { CONSTITUTION } from './constitution'

export type Kept = { draft: Draft; verdict: Verdict }

export type ProduceResult = {
  kept: Kept[]
  dropped: Array<{ draft: Draft; verdict: Verdict }>
  /** Set whenever nothing survives. Always populated — a silent zero reads as broken. */
  nothingBecause?: string
  receipt: { model: string; inputTokens: number; outputTokens: number }
}

/**
 * The whole product, in one function: read the calls, write, judge, keep what
 * survives. No stages, no revision, no second pass.
 *
 * Nothing that fails is repaired. If a post wasn't there, it wasn't there —
 * and the honest zero is the output, said in words the person can act on.
 */
/**
 * Engine overrides. Production passes nothing and gets the user's connected
 * engine; tests and the bake-off harness pass explicit ones, which is also what
 * lets the harness run the same code path against a different model.
 */
export type ProduceEngines = { writer?: Engine; jury?: Engine }

export async function produce(
  cred: EngineCredential,
  calls: CallInput[],
  ctx: WriteContext = {},
  engines: ProduceEngines = {},
): Promise<ProduceResult> {
  const written = await write(engines.writer ?? engineFor(cred), calls, ctx)

  const receipt = {
    model: written.model,
    inputTokens: written.inputTokens,
    outputTokens: written.outputTokens,
  }

  if (written.drafts.length === 0) {
    return { kept: [], dropped: [], nothingBecause: written.nothingBecause, receipt }
  }

  const sources = calls.map((c) => c.transcript)
  const jury = engines.jury ?? judgeEngineFor(cred)

  // Withdraw unverifiable verbatim claims before judging: a paraphrase wearing
  // quote marks loses its marks, not its post. Anything still unmatched after
  // this (nested or malformed quoting) is fabrication and the judge kills it.
  const cleaned = written.drafts.map((draft) => {
    const quotes = checkQuotes(draft.body, sources)
    return quotes.ok ? draft : { ...draft, body: dequoteUnmatched(draft.body, quotes.unmatched) }
  })

  // Judge each draft independently and never let one failure take the others
  // down. Writing is the expensive step; losing two good drafts because a cheap
  // judge call hit a rate limit would be the worst trade in the product.
  //
  // A draft whose verdict could not be obtained is dropped, not kept. Failing
  // closed is the only safe default — publishing something unjudged is exactly
  // what the judge exists to prevent.
  const judged = await Promise.all(
    cleaned.map(async (draft) => {
      try {
        return { draft, verdict: await judge(jury, draft, sources, ctx.audience) }
      } catch {
        return { draft, verdict: unjudgeable(draft) }
      }
    }),
  )

  const kept = judged.filter((j) => j.verdict.publish)
  const dropped = judged.filter((j) => !j.verdict.publish)

  return {
    kept,
    dropped,
    nothingBecause: kept.length === 0 ? nothingLine(dropped) : undefined,
    receipt,
  }
}

/**
 * When everything is dropped, say which wall it hit. "Nothing this week" with
 * no reason is indistinguishable from a broken product, and the reason is the
 * only part the person can do anything about.
 */
/** A verdict that could not be reached. Fails closed and says so honestly. */
function unjudgeable(_draft: Draft): Verdict {
  return {
    publish: false,
    reach: 0,
    strangerTakeaway: '',
    insiderTerms: [],
    craft: Object.fromEntries(CRAFT_MARKS.map((m) => [m, 'weak'])) as Verdict['craft'],
    // Neutral, not failed: the quote check is not what went wrong, and marking
    // it failed would make the summary line blame fabrication that never happened.
    quotes: { ok: true, unmatched: [], checked: 0 },
    droppedBecause: 'Couldn’t check this one. Try again.',
  }
}

function nothingBecauseReach(dropped: Array<{ verdict: Verdict }>): boolean {
  return dropped.every((d) => d.verdict.reach > 0 && d.verdict.reach < 6)
}

function nothingLine(dropped: Array<{ verdict: Verdict }>): string {
  if (dropped.length === 0) return 'Nothing in these calls carried a story worth publishing.'
  if (dropped.some((d) => !d.verdict.quotes.ok))
    return 'What came back quoted something that was never said, so none of it is publishable.'
  if (nothingBecauseReach(dropped))
    return 'These calls were about the work itself. Real, but nothing a reader outside them could use.'
  return 'Nothing this week cleared the bar — the writing was there, the story wasn’t.'
}

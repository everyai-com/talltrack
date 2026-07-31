import type { Engine, EngineCredential } from '../engine'
import { engineFor, judgeEngineFor } from '../engine'
import { write, type CallInput, type Draft, type WriteContext } from './write'
import { judge, type Verdict } from './judge'

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

  const judged = await Promise.all(
    written.drafts.map(async (draft) => ({ draft, verdict: await judge(jury, draft, sources, ctx.audience) })),
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

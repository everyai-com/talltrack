/**
 * The claim ledger's replacement.
 *
 * Callcraft made fabrication structurally impossible by requiring every line to
 * cite evidence — and made good prose structurally impossible with it
 * (docs/PLAN.md §0.2). Dropping the ledger means fabrication becomes a checked
 * property rather than a guaranteed one, so the check has to be exact.
 *
 * This is deliberately deterministic code, not a model call. "Does this string
 * appear in that string" is not a judgement, and asking a model to do it would
 * introduce the one failure mode the check exists to eliminate.
 */

/** Curly quotes, non-breaking spaces and collapsed whitespace all count as the same text. */
export function normalize(s: string): string {
  return s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Quoted spans in the post body. Only double quotes count: apostrophes and
 * single-quoted asides are far too noisy to treat as claims of verbatim speech.
 */
export function extractQuotes(body: string): string[] {
  const normalizedBody = body.replace(/[“”‟]/g, '"')
  const found: string[] = []
  const re = /"([^"\n]{8,400})"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(normalizedBody)) !== null) {
    const inner = m[1]
    if (inner) found.push(inner.trim())
  }
  return found
}

export type QuoteCheck = {
  ok: boolean
  /** Quotes that appear nowhere in the source. Any one of these fails the draft. */
  unmatched: string[]
  checked: number
}

/**
 * A quote passes if it appears in the transcript, allowing for an ellipsis
 * standing in for elided middles — a writer trimming "um, so I think the, the
 * balance date" down to "the balance date" is honest editing, not fabrication.
 */
export function checkQuotes(body: string, sources: string[]): QuoteCheck {
  const haystack = normalize(sources.join('\n'))
  const quotes = extractQuotes(body)
  const unmatched: string[] = []

  for (const quote of quotes) {
    const segments = quote
      .split(/\s*(?:\.\.\.|…)\s*/)
      .map(normalize)
      .filter((seg) => seg.length > 0)

    if (segments.length === 0) continue

    // Segments must appear in order, so an ellipsis can elide a middle but
    // cannot stitch together two unrelated parts of a call.
    let cursor = 0
    let matched = true
    for (const seg of segments) {
      const at = haystack.indexOf(seg, cursor)
      if (at === -1) {
        matched = false
        break
      }
      cursor = at + seg.length
    }

    if (!matched) unmatched.push(quote)
  }

  return { ok: unmatched.length === 0, unmatched, checked: quotes.length }
}

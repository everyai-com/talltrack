import { describe, expect, it } from 'vitest'
import { checkQuotes, extractQuotes, normalize } from '../src/writer/quote-check'

const CALL = `Priya: So we looked at the numbers again and honestly, the balance date was the whole problem.
Sam: Right, and you'd already signed off on the import by then.
Priya: We had. That's the part that stings — we signed off, then found it.`

describe('quote check', () => {
  it('passes a quote that is really in the call', () => {
    const body = 'She put it plainly: "the balance date was the whole problem."'
    expect(checkQuotes(body, [CALL])).toMatchObject({ ok: true, unmatched: [], checked: 1 })
  })

  it('fails a quote that was never said', () => {
    const body = 'She told me, "we lost four hundred thousand dollars on that import."'
    const result = checkQuotes(body, [CALL])
    expect(result.ok).toBe(false)
    expect(result.unmatched).toHaveLength(1)
  })

  it('fails a quote that is subtly reworded — the dangerous case', () => {
    // Every word appears in the call; this exact sentence never does. A fuzzy
    // matcher would pass it, and a plausible-but-wrong quote is worse than an
    // obviously invented one because nobody catches it.
    const body = 'He said, "the balance date was the only problem."'
    expect(checkQuotes(body, [CALL]).ok).toBe(false)
  })

  it('allows an ellipsis to elide a middle', () => {
    const body = '"we signed off ... then found it"'
    expect(checkQuotes(body, [CALL]).ok).toBe(true)
  })

  it('does not let an ellipsis stitch unrelated parts back to front', () => {
    // Both fragments exist, but in the opposite order. Order matters or an
    // ellipsis becomes a licence to assemble a sentence nobody said.
    const body = '"that\'s the part that stings ... So we looked at the numbers"'
    expect(checkQuotes(body, [CALL]).ok).toBe(false)
  })

  it('treats curly quotes, dashes and odd spacing as the same text', () => {
    const body = '"That’s the part that stings — we signed off, then found it."'
    expect(checkQuotes(body, [CALL]).ok).toBe(true)
  })

  it('ignores apostrophes and single quotes', () => {
    expect(extractQuotes("it's a 'thing' he mentioned")).toEqual([])
  })

  it('passes a post with no quotes at all', () => {
    const body = 'They signed off on the import before anyone checked the date.'
    expect(checkQuotes(body, [CALL])).toMatchObject({ ok: true, checked: 0 })
  })

  it('normalizes consistently', () => {
    expect(normalize('  The  “Balance” Date — yes ')).toBe('the "balance" date - yes')
  })
})

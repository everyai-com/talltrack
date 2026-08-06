/**
 * Deterministic shape check against the measured corpus signature. Not a
 * model call — the same philosophy as the quote check. It reports, it does
 * not rewrite: a post that misses the shape gets named misses so the writer
 * (server-side or Claude over MCP) can fix them with intent.
 *
 * Thresholds sit deliberately looser than the top-300 medians (hook 44
 * chars, 91% short lines) so a genuinely lived story in slightly longer
 * lines still passes; a six-paragraph essay does not.
 */

export type ShapeReport = {
  ok: boolean
  hookChars: number
  shortLinePct: number
  longestBlockLines: number
  misses: string[]
}

const HOOK_MAX = 80
const SHORT_LINE = 60
const SHORT_LINE_MIN_PCT = 50
const BLOCK_MAX_CHARS = 220

export function checkShape(body: string): ShapeReport {
  const lines = body.split('\n')
  const blocks = body
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
  const content = lines.map((l) => l.trim()).filter(Boolean)
  const hook = content[0] ?? ''
  const shortLinePct = Math.round(
    (100 * content.filter((l) => l.length <= SHORT_LINE).length) / Math.max(1, content.length),
  )
  const longestBlock = blocks.reduce((max, b) => Math.max(max, b.length), 0)

  const misses: string[] = []
  if (hook.length > HOOK_MAX)
    misses.push(
      `The hook is ${hook.length} characters — the corpus median is 44. Make the first line one short punch (under ${HOOK_MAX}).`,
    )
  if (shortLinePct < SHORT_LINE_MIN_PCT)
    misses.push(
      `Only ${shortLinePct}% of lines are under ${SHORT_LINE} characters — the top posts run ~91%. Break the paragraphs into 1-3 line mobile blocks.`,
    )
  if (longestBlock > BLOCK_MAX_CHARS)
    misses.push(
      `The longest block is ${longestBlock} characters — that reads as a wall on a phone. No block should pass ~${BLOCK_MAX_CHARS}.`,
    )

  return {
    ok: misses.length === 0,
    hookChars: hook.length,
    shortLinePct,
    longestBlockLines: blocks.length,
    misses,
  }
}

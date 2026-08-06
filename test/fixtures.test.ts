import { describe, expect, it } from 'vitest'
import { MIXED_PROVIDER_CALLS, PUBLISHABLE_CALL, ROUTINE_CALL } from './fixtures/calls'
import { parseDrafts, write } from '../src/writer/write'
import type { Engine, RunResult } from '../src/engine'

function scripted(replies: string[]): Engine {
  let index = 0
  return {
    name: 'claude',
    async run(): Promise<RunResult> {
      const text = replies[Math.min(index++, replies.length - 1)] ?? ''
      return { text, model: 'fixture-model', inputTokens: 1, outputTokens: 1 }
    },
  }
}

describe('regression fixtures', () => {
  it('keeps a genuinely funded call available to the writer', async () => {
    const result = await write(
      scripted([
        `<post>
TENSION: what they thought they needed vs the handoff that failed
CALLS: ${PUBLISHABLE_CALL.id}
BODY:
A post with the spreadsheet handoff.
</post>`,
      ]),
      [PUBLISHABLE_CALL],
    )
    expect(result.drafts[0]?.callIds).toEqual([PUBLISHABLE_CALL.id])
  })

  it('preserves an honest zero for routine calls', async () => {
    const result = await write(
      scripted(['<nothing>A routine status update with no useful tension.</nothing>']),
      [ROUTINE_CALL],
    )
    expect(result.drafts).toEqual([])
    expect(result.nothingBecause).toContain('routine status update')
  })

  it('keeps provider provenance when material is mixed', () => {
    expect(MIXED_PROVIDER_CALLS.map((call) => call.source)).toEqual(['fathom', 'gong'])
  })

  it('parses a useful zero reason instead of silently dropping it', () => {
    expect(parseDrafts('<nothing>Four status calls.</nothing>').nothingBecause).toBe(
      'Four status calls.',
    )
  })
})

import { describe, expect, it } from 'vitest'
import { atLeast, craftPasses, judge, parseVerdict, REACH_FLOOR, type Band, type CraftMark } from '../src/writer/judge'
import { produce } from '../src/writer'
import type { Engine, RunRequest, RunResult } from '../src/engine'

function craft(overrides: Partial<Record<CraftMark, Band>> = {}): Record<CraftMark, Band> {
  return {
    hook: 'ready', story: 'ready', tension: 'solid', insight: 'solid',
    voice: 'ready', payoff: 'solid', memorability: 'solid',
    ...overrides,
  }
}

function verdictJson(reach: number, marks = craft()) {
  return JSON.stringify({
    reach,
    stranger_takeaway: 'check the date before you trust an import',
    insider_terms: [],
    craft: marks,
    why: 'lands',
  })
}

const CALL = 'Priya: the balance date was the whole problem.'

function scriptedEngine(replies: string[], capture?: (req: RunRequest) => void): Engine {
  let i = 0
  return {
    name: 'claude',
    async run(req): Promise<RunResult> {
      capture?.(req)
      const text = replies[Math.min(i, replies.length - 1)] ?? ''
      i++
      return { text, model: 'test-model', inputTokens: 1, outputTokens: 1 }
    },
  }
}

describe('bands', () => {
  it('orders correctly', () => {
    expect(atLeast('ready', 'solid')).toBe(true)
    expect(atLeast('generic', 'ready')).toBe(false)
    expect(atLeast('rare', 'rare')).toBe(true)
  })

  it('treats an unrecognized band as weak rather than guessing upward', () => {
    const parsed = parseVerdict(JSON.stringify({ reach: 8, craft: { hook: 'excellent' } }))
    expect(parsed.craft.hook).toBe('weak')
  })

  it('clamps a reach score outside the scale', () => {
    expect(parseVerdict(JSON.stringify({ reach: 47 })).reach).toBe(10)
    expect(parseVerdict(JSON.stringify({ reach: -3 })).reach).toBe(1)
  })
})

describe('craft floor', () => {
  it('passes solid work with two strong marks', () => {
    expect(craftPasses(craft())).toBe(true)
  })

  it('fails anything with a weak mark', () => {
    expect(craftPasses(craft({ payoff: 'weak' }))).toBe(false)
  })

  it('fails an all-generic post — competent and forgettable is not publishable', () => {
    const generic = Object.fromEntries(
      (['hook', 'story', 'tension', 'insight', 'voice', 'payoff', 'memorability'] as CraftMark[]).map((m) => [m, 'generic']),
    ) as Record<CraftMark, Band>
    expect(craftPasses(generic)).toBe(false)
  })
})

describe('judge', () => {
  it('vetoes on reach even when the craft is strong — the 127-posts failure', async () => {
    const v = await judge(scriptedEngine([verdictJson(4)]), { body: 'a post', tension: 't', callIds: [] }, [CALL])
    expect(v.publish).toBe(false)
    expect(v.droppedBecause).toContain('wasn’t on the call')
  })

  it('publishes at exactly the reach floor', async () => {
    const v = await judge(scriptedEngine([verdictJson(REACH_FLOOR)]), { body: 'a post', tension: 't', callIds: [] }, [CALL])
    expect(v.publish).toBe(true)
  })

  it('fails an invented quote without spending a model call', async () => {
    let calls = 0
    const engine = scriptedEngine([verdictJson(9)], () => {
      calls++
    })
    const v = await judge(engine, { body: 'She said, "we lost the account."', tension: 't', callIds: [] }, [CALL])
    expect(v.publish).toBe(false)
    expect(calls).toBe(0)
    expect(v.droppedBecause).toContain('does not appear in the call')
  })

  it('judges near-deterministically so a verdict does not flip between runs', async () => {
    let seen: RunRequest | undefined
    await judge(
      scriptedEngine([verdictJson(8)], (req) => {
        seen = req
      }),
      { body: 'a post', tension: 't', callIds: [] },
      [CALL],
    )
    expect(seen?.temperature).toBe(0)
  })
})

describe('produce', () => {
  const cred = { engine: 'claude' as const, secret: 'test' }
  const calls = [{ id: 'c1', title: 'Acme', occurredAt: '2026-07-30T10:00:00Z', transcript: CALL }]
  const oneDraft = JSON.stringify({ drafts: [{ tension: 't', body: 'a post about the import', call_ids: ['c1'] }] })

  it('keeps a draft that clears both checks', async () => {
    const result = await produce(cred, calls, {}, {
      writer: scriptedEngine([oneDraft]),
      jury: scriptedEngine([verdictJson(8)]),
    })
    expect(result.kept).toHaveLength(1)
    expect(result.dropped).toHaveLength(0)
    expect(result.nothingBecause).toBeUndefined()
  })

  it('drops what fails instead of revising it', async () => {
    const result = await produce(cred, calls, {}, {
      writer: scriptedEngine([oneDraft]),
      jury: scriptedEngine([verdictJson(3)]),
    })
    expect(result.kept).toHaveLength(0)
    expect(result.dropped).toHaveLength(1)
    // The reason names the wall it hit, not a generic apology.
    expect(result.nothingBecause).toContain('nothing a reader outside them could use')
  })

  it('names fabrication specifically when that is why nothing survived', async () => {
    const invented = JSON.stringify({
      drafts: [{ tension: 't', body: 'He said, "we lost the account."', call_ids: ['c1'] }],
    })
    const result = await produce(cred, calls, {}, {
      writer: scriptedEngine([invented]),
      jury: scriptedEngine([verdictJson(9)]),
    })
    expect(result.kept).toHaveLength(0)
    expect(result.nothingBecause).toContain('never said')
  })

  it('carries a cost receipt even on a week that produced nothing', async () => {
    const result = await produce(cred, calls, {}, {
      writer: scriptedEngine(['{"drafts":[],"nothing_because":"All scheduling."}']),
      jury: scriptedEngine([verdictJson(9)]),
    })
    expect(result.nothingBecause).toBe('All scheduling.')
    expect(result.receipt.model).toBe('test-model')
  })
})

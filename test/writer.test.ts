import { describe, expect, it } from 'vitest'
import { buildWritePrompt, MAX_DRAFTS, parseWriteResponse, write } from '../src/writer/write'
import { CONSTITUTION, MIN_VOICE_EXAMPLES } from '../src/writer/constitution'
import type { Engine, RunRequest, RunResult } from '../src/engine'

function fakeEngine(text: string, capture?: (req: RunRequest) => void): Engine {
  return {
    name: 'claude',
    async run(req): Promise<RunResult> {
      capture?.(req)
      return { text, model: 'test-model', inputTokens: 10, outputTokens: 20 }
    },
  }
}

const CALLS = [{ id: 'c1', title: 'Acme review', occurredAt: '2026-07-30T10:00:00Z', transcript: 'Sam: hello' }]

describe('write prompt', () => {
  it('carries the constitution and the whole transcript', () => {
    const { system, user } = buildWritePrompt(CALLS)
    expect(system).toContain(CONSTITUTION)
    expect(user).toContain('Sam: hello')
    expect(user).toContain('id="c1"')
  })

  it('omits voice calibration when there are too few examples to learn from', () => {
    const thin = buildWritePrompt(CALLS, { publishedExamples: ['one post'] })
    expect(thin.system).not.toContain('THIS PERSON'.concat('’S VOICE'))

    const enough = buildWritePrompt(CALLS, {
      publishedExamples: Array.from({ length: MIN_VOICE_EXAMPLES }, (_, i) => `post ${i}`),
    })
    expect(enough.system).toContain('published post 1')
  })

  it('does not let a call title break out of its attribute', () => {
    const { user } = buildWritePrompt([{ ...CALLS[0]!, title: 'a "quoted" <tag> title' }])
    expect(user).toContain(`title="a 'quoted' tag title"`)
  })
})

describe('parsing what comes back', () => {
  it('reads drafts out of a fenced or prefixed response', () => {
    const text = 'Here you go:\n```json\n{"drafts":[{"tension":"t","body":"b","call_ids":["c1"]}]}\n```'
    expect(parseWriteResponse(text).drafts).toEqual([{ tension: 't', body: 'b', callIds: ['c1'] }])
  })

  it('drops a draft with no stated tension — law 2 is not decoration', () => {
    const text = '{"drafts":[{"tension":"","body":"a real post","call_ids":[]}]}'
    expect(parseWriteResponse(text).drafts).toEqual([])
  })

  it('caps the number of drafts, because volume is the enemy', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ tension: `t${i}`, body: `b${i}`, call_ids: [] }))
    expect(parseWriteResponse(JSON.stringify({ drafts: many })).drafts).toHaveLength(MAX_DRAFTS)
  })

  it('keeps the reason when the honest answer is zero', () => {
    const text = '{"drafts":[],"nothing_because":"Four scheduling calls and a status update."}'
    const parsed = parseWriteResponse(text)
    expect(parsed.drafts).toEqual([])
    expect(parsed.nothingBecause).toBe('Four scheduling calls and a status update.')
  })
})

describe('write', () => {
  it('never returns a silent zero', async () => {
    const result = await write(fakeEngine('{"drafts":[]}'), CALLS)
    expect(result.drafts).toEqual([])
    expect(result.nothingBecause).toBeTruthy()
  })

  it('returns early without calling the engine when there are no calls', async () => {
    let called = false
    const engine = fakeEngine('{"drafts":[]}', () => {
      called = true
    })
    const result = await write(engine, [])
    expect(called).toBe(false)
    expect(result.nothingBecause).toBe('No calls this week.')
  })

  it('runs the writer warm — a cold writer returns the median sentence', async () => {
    let seen: RunRequest | undefined
    await write(
      fakeEngine('{"drafts":[]}', (req) => {
        seen = req
      }),
      CALLS,
    )
    expect(seen?.temperature).toBe(1)
  })
})

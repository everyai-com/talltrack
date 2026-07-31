import { describe, expect, it } from 'vitest'
import { cleanPost, MAX_DRAFTS, parseStories, write } from '../src/writer/write'
import { CONSTITUTION } from '../src/writer/constitution'
import { WRITING_STYLE } from '../src/writer/style'
import { LINKEDIN_TEMPLATE_LIBRARY } from '../src/writer/references'
import type { Engine, RunRequest, RunResult } from '../src/engine'

/** Replies in order; repeats the last one if called again. Captures every request. */
function scripted(replies: string[], seen: RunRequest[] = []): Engine {
  let i = 0
  return {
    name: 'claude',
    async run(req): Promise<RunResult> {
      seen.push(req)
      const text = replies[Math.min(i, replies.length - 1)] ?? ''
      i++
      return { text, model: 'test-model', inputTokens: 10, outputTokens: 5 }
    },
  }
}

const CALLS = [{ id: 'c1', title: 'Acme review', occurredAt: '2026-07-30T10:00:00Z', transcript: 'Sam: hello' }]

const ONE_STORY = JSON.stringify({
  stories: [{ tension: 'expected vs actual', call_ids: ['c1'], material: 'the signed-off import' }],
})

describe('phase 1 — find', () => {
  it('parses stories and caps them', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ tension: `t${i}`, call_ids: [], material: 'm' }))
    expect(parseStories(JSON.stringify({ stories: many })).stories).toHaveLength(MAX_DRAFTS)
  })

  it('drops a story with no tension — law 2 is not decoration', () => {
    const text = JSON.stringify({ stories: [{ tension: '', call_ids: ['c1'], material: 'm' }] })
    expect(parseStories(text).stories).toEqual([])
  })

  it('keeps the reason when the honest answer is zero', () => {
    const parsed = parseStories(JSON.stringify({ stories: [], nothing_because: 'All scheduling.' }))
    expect(parsed.stories).toEqual([])
    expect(parsed.nothingBecause).toBe('All scheduling.')
  })
})

describe('prose hygiene', () => {
  it('strips fences and announcement lines models add despite instructions', () => {
    expect(cleanPost('```\nThe post.\n```')).toBe('The post.')
    expect(cleanPost("Here's the post:\nThe post.")).toBe('The post.')
    expect(cleanPost('  The post.  ')).toBe('The post.')
  })

  it('leaves an already-clean post alone', () => {
    const post = 'He signed. Then he asked us to remove the feature.\n\nThat was the week.'
    expect(cleanPost(post)).toBe(post)
  })
})

describe('the phased write', () => {
  it('finds, writes one post per story as prose, then cuts it', async () => {
    const seen: RunRequest[] = []
    const engine = scripted([ONE_STORY, 'A drafted post about the import.', 'A tighter post about the import.'], seen)

    const result = await write(engine, CALLS)

    expect(seen).toHaveLength(3)
    // Phase 1 reads everything and only finds.
    expect(seen[0]!.system).toContain('FIND')
    expect(seen[0]!.user).toContain('Sam: hello')
    // Phase 2 carries the full writing law and the verbatim references, and
    // demands prose, not JSON.
    expect(seen[1]!.system).toContain(WRITING_STYLE.slice(0, 60))
    expect(seen[1]!.system).toContain(LINKEDIN_TEMPLATE_LIBRARY.slice(0, 40))
    expect(seen[1]!.system).toContain('WRITE ONE POST')
    expect(seen[1]!.user).toContain('expected vs actual')
    // Phase 3 is a cut, not a rewrite.
    expect(seen[2]!.system).toContain('EDITOR')
    expect(seen[2]!.user).toBe('A drafted post about the import.')

    expect(result.drafts).toEqual([
      { body: 'A tighter post about the import.', tension: 'expected vs actual', callIds: ['c1'] },
    ])
    // The receipt sums every phase.
    expect(result.inputTokens).toBe(30)
  })

  it('returns the honest zero without spending write calls', async () => {
    const seen: RunRequest[] = []
    const engine = scripted([JSON.stringify({ stories: [], nothing_because: 'Four status calls.' })], seen)
    const result = await write(engine, CALLS)
    expect(seen).toHaveLength(1)
    expect(result.drafts).toEqual([])
    expect(result.nothingBecause).toBe('Four status calls.')
  })

  it('never returns a silent zero', async () => {
    const result = await write(scripted(['{"stories":[]}']), CALLS)
    expect(result.nothingBecause).toBeTruthy()
  })

  it('returns early without calling the engine when there are no calls', async () => {
    const seen: RunRequest[] = []
    const result = await write(scripted([ONE_STORY], seen), [])
    expect(seen).toHaveLength(0)
    expect(result.nothingBecause).toBe('No calls this week.')
  })

  it('one story failing does not take the others down', async () => {
    const twoStories = JSON.stringify({
      stories: [
        { tension: 't1', call_ids: ['c1'], material: 'm1' },
        { tension: 't2', call_ids: ['c1'], material: 'm2' },
      ],
    })
    let call = 0
    const engine: Engine = {
      name: 'claude',
      async run(): Promise<RunResult> {
        call++
        if (call === 1) return { text: twoStories, model: 'm', inputTokens: 1, outputTokens: 1 }
        // First story's draft call dies; second story's draft + cut succeed.
        if (call === 2) throw new Error('429')
        return { text: 'surviving post', model: 'm', inputTokens: 1, outputTokens: 1 }
      },
    }
    const result = await write(engine, CALLS)
    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0]!.tension).toBe('t2')
  })

  it('the constitution rides every writing phase', async () => {
    const seen: RunRequest[] = []
    await write(scripted([ONE_STORY, 'draft', 'cut'], seen), CALLS)
    expect(seen[0]!.system).toContain(CONSTITUTION.slice(0, 60))
    expect(seen[1]!.system).toContain(CONSTITUTION.slice(0, 60))
  })
})

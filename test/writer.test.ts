import { describe, expect, it } from 'vitest'
import {
  buildEditorialContext,
  cleanPost,
  MAX_DRAFTS,
  MAX_EVALUATION_DRAFTS,
  parseDrafts,
  write,
} from '../src/writer/write'
import { CONSTITUTION } from '../src/writer/constitution'
import { WRITING_STYLE } from '../src/writer/style'
import { AIOS_LINKEDIN_GUIDE } from '../src/writer/aios-guide'
import { FOUNDER_EXEMPLAR } from '../src/writer/references'
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
const ONE_POST = `<post>
TENSION: expected vs actual
CALLS: c1
BODY:
He signed. Then he asked us to remove the feature.

That was the week.
</post>`

describe('one-pass AIOS writer', () => {
  it('parses tagged prose and caps candidates', () => {
    const many = Array.from({ length: 9 }, (_, i) => `<post>
TENSION: t${i}
CALLS: c1
BODY:
Post ${i}.
</post>`).join('\n')

    expect(parseDrafts(many).drafts).toHaveLength(MAX_DRAFTS)
    expect(parseDrafts(many, MAX_EVALUATION_DRAFTS).drafts).toHaveLength(5)
  })

  it('drops malformed posts without a tension, body, or call receipt', () => {
    expect(parseDrafts('<post>\nCALLS: c1\nBODY:\nNo tension.</post>').drafts).toEqual([])
    expect(parseDrafts('<post>\nTENSION: real\nBODY:\nNo call.</post>').drafts).toEqual([])
  })

  it('keeps the honest zero reason', () => {
    expect(parseDrafts('<nothing>Four status calls.</nothing>').nothingBecause).toBe('Four status calls.')
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

describe('shared AIOS editorial context', () => {
  it('contains the AIOS bar and founder register without Callcraft templates', () => {
    const context = buildEditorialContext({
      audience: 'Operators who own revenue systems. Voice: direct and warm.',
      publishedExamples: ['Published example one', 'Published example two', 'Published example three'],
    })

    expect(context).toContain(CONSTITUTION.slice(0, 60))
    expect(context).toContain(WRITING_STYLE.slice(0, 60))
    expect(context).toContain(AIOS_LINKEDIN_GUIDE.slice(0, 60))
    expect(context).toContain(FOUNDER_EXEMPLAR.slice(0, 60))
    expect(context).toContain('Published example two')
    expect(context).toContain('Operators who own revenue systems')
    expect(context).not.toContain('TEMPLATE 1')
    expect(context).not.toContain('CALLCRAFT STRUCTURAL BLUEPRINT CATALOG')
  })

  it('writes all supported candidates in one prose call', async () => {
    const seen: RunRequest[] = []
    const engine = scripted([ONE_POST], seen)
    const result = await write(engine, CALLS)

    expect(seen).toHaveLength(1)
    expect(seen[0]!.system).toContain('AIOS LINKEDIN WRITING GUIDE')
    expect(seen[0]!.system).toContain('Do not return JSON')
    expect(seen[0]!.system).not.toContain('SELECTED BLUEPRINT')
    expect(seen[0]!.system).not.toContain('TEMPLATE 1')
    expect(seen[0]!.user).toContain('Sam: hello')
    expect(result.drafts).toEqual([
      { body: 'He signed. Then he asked us to remove the feature.\n\nThat was the week.', tension: 'expected vs actual', callIds: ['c1'] },
    ])
    expect(result.inputTokens).toBe(10)
  })

  it('returns the honest zero without a second writing or cut call', async () => {
    const seen: RunRequest[] = []
    const result = await write(scripted(['<nothing>Four status calls.</nothing>'], seen), CALLS)
    expect(seen).toHaveLength(1)
    expect(result.drafts).toEqual([])
    expect(result.nothingBecause).toBe('Four status calls.')
  })

  it('never returns a silent zero', async () => {
    const result = await write(scripted(['no tagged output']), CALLS)
    expect(result.nothingBecause).toBeTruthy()
  })

  it('returns early without calling the engine when there are no calls', async () => {
    const seen: RunRequest[] = []
    const result = await write(scripted([ONE_POST], seen), [])
    expect(seen).toHaveLength(0)
    expect(result.nothingBecause).toBe('No calls this week.')
  })

  it('drops drafts whose call receipts do not resolve to this window', async () => {
    const result = await write(scripted([ONE_POST.replace('CALLS: c1', 'CALLS: unknown')]), CALLS)
    expect(result.drafts).toEqual([])
    expect(result.nothingBecause).toBeTruthy()
  })

  it('supports five candidates only for an explicit evaluation run', async () => {
    const posts = Array.from({ length: 5 }, (_, i) => `<post>
TENSION: t${i}
CALLS: c1
BODY:
Post ${i}.
</post>`).join('\n')
    const seen: RunRequest[] = []
    const result = await write(scripted([posts], seen), CALLS, { candidateLimit: 5 })

    expect(result.drafts).toHaveLength(5)
    expect(seen).toHaveLength(1)
  })

  it('uses the same editorial context in the one writing request', async () => {
    const seen: RunRequest[] = []
    await write(scripted([ONE_POST], seen), CALLS)
    expect(seen[0]!.system).toContain(CONSTITUTION.slice(0, 60))
    expect(seen[0]!.system).toContain(AIOS_LINKEDIN_GUIDE.slice(0, 60))
  })
})

import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadPublishedExamples, recordOutcome } from '../src/db/posts'

async function seed(id: string, body: string) {
  await env.DB.prepare(
    `insert into posts (id, workspace_id, body, tension, call_ids, reach, craft, stranger_takeaway)
     values (?1, 'solo', ?2, 'expected vs actual', '[]', 7, '{}', null)`,
  )
    .bind(id, body)
    .run()
}

describe('post outcomes', () => {
  beforeEach(async () => {
    await env.DB.prepare(`delete from posts`).run()
  })

  it('records published and edited outcomes, then feeds the actual published text back', async () => {
    await seed('published-post', 'Original copy')
    await seed('edited-post', 'Draft copy')
    await recordOutcome(env, 'solo', 'published-post', 'published')
    await recordOutcome(env, 'solo', 'edited-post', 'published_after_edit', 'What I actually published')

    const examples = await loadPublishedExamples(env, 'solo')
    expect(examples).toContain('Original copy')
    expect(examples).toContain('What I actually published')
    expect(examples).not.toContain('Draft copy')
  })

  it('records rejection without making it a voice example', async () => {
    await seed('rejected-post', 'A draft I skipped')
    const response = await SELF.fetch('https://talltrack.test/api/posts/rejected-post/outcome', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'rejected' }),
    })
    expect(response.status).toBe(200)
    expect(await loadPublishedExamples(env, 'solo')).not.toContain('A draft I skipped')
    const row = await env.DB.prepare(`select outcome, reject_reason from posts where id = 'rejected-post'`).first<{
      outcome: string
      reject_reason: string
    }>()
    expect(row).toMatchObject({ outcome: 'rejected', reject_reason: 'Not publishing' })
  })

  it('keeps the edited published body separate from the generated draft', async () => {
    await seed('edited-visible-post', 'Generated draft')
    const response = await SELF.fetch('https://talltrack.test/api/posts/edited-visible-post/outcome', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'published_after_edit', publishedBody: 'Published after a human edit' }),
    })
    expect(response.status).toBe(200)
    const row = await env.DB.prepare(`select body, outcome, published_body from posts where id = 'edited-visible-post'`).first<{
      body: string
      outcome: string
      published_body: string
    }>()
    expect(row).toEqual({ body: 'Generated draft', outcome: 'published_after_edit', published_body: 'Published after a human edit' })
  })

  it('cannot update another workspace through the route', async () => {
    await env.DB.prepare(
      `insert into posts (id, workspace_id, body, tension, call_ids, reach, craft, stranger_takeaway)
       values ('other-post', 'other-workspace', 'Private', 'tension', '[]', 0, '{}', null)`,
    ).run()
    const response = await SELF.fetch('https://talltrack.test/api/posts/other-post/outcome', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'published' }),
    })
    expect(response.status).toBe(404)
  })
})

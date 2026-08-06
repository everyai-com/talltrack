export type PostOutcome = 'published' | 'published_after_edit' | 'rejected'

export type PostsEnv = Pick<Cloudflare.Env, 'DB'>

export async function loadPublishedExamples(env: PostsEnv, workspaceId: string, limit = 10): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `select case when outcome = 'published_after_edit' then published_body else body end as example
     from posts
     where workspace_id = ?1 and outcome in ('published', 'published_after_edit')
       and length(trim(case when outcome = 'published_after_edit' then coalesce(published_body, '') else body end)) > 0
     order by coalesce(outcome_at, created_at) desc limit ?2`,
  )
    .bind(workspaceId, limit)
    .all<{ example: string | null }>()

  return (results ?? []).map((row) => row.example?.trim() ?? '').filter(Boolean)
}

export async function recordOutcome(
  env: PostsEnv,
  workspaceId: string,
  postId: string,
  outcome: PostOutcome,
  publishedBody?: string,
  rejectReason?: string,
): Promise<boolean> {
  const edited = outcome === 'published_after_edit'
  const body = edited ? publishedBody?.trim() : null
  if (edited && !body) throw new Error('published_body_required')

  const result = await env.DB.prepare(
    `update posts set outcome = ?1, outcome_at = ?2, published_body = ?3, reject_reason = ?4
     where workspace_id = ?5 and id = ?6`,
  )
    .bind(
      outcome,
      new Date().toISOString(),
      body,
      outcome === 'rejected' ? rejectReason?.trim() || 'Not publishing' : null,
      workspaceId,
      postId,
    )
    .run()

  return (result.meta.changes ?? 0) > 0
}

export function isPostOutcome(value: unknown): value is PostOutcome {
  return value === 'published' || value === 'published_after_edit' || value === 'rejected'
}

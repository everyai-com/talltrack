import { Hono } from 'hono'
import type { Env } from '../index'
import { workspaceOf } from '../auth'
import { PROVIDER_CAPABILITIES, syncActiveNotetakers } from '../ingest/sync'
import { loadCalls } from '../db/calls'
import { loadPublishedExamples } from '../db/posts'
import { loadCredential } from '../db/providers'
import { audienceContext, deriveProfile, loadProfile, saveProfile } from '../profile'
import { judgeEngineFor, EngineError } from '../engine'
import { produce } from '../writer'

export const week = new Hono<{ Bindings: Env }>()

const WEEK_MS = 7 * 86_400_000
/** Enough calls to learn a voice from; few enough to keep derivation quick. */
const PROFILE_CALLS = 5

function evaluationCandidateLimit(raw: string | undefined): 4 | 5 | undefined {
  const value = Number(raw)
  return Number.isInteger(value) && (value === 4 || value === 5) ? value : undefined
}

type PostRow = {
  id: string
  body: string
  tension: string
  reach: number
  stranger_takeaway: string | null
  created_at: string
  outcome: string | null
  published_body: string | null
}

/** The front door's data: this week's posts, or the honest reason there are none. */
week.get('/', async (c) => {
  const workspaceId = await workspaceOf(c.req.raw, c.env)
  const since = new Date(Date.now() - WEEK_MS).toISOString()

  const { results: posts } = await c.env.DB.prepare(
    `select id, body, tension, reach, stranger_takeaway, created_at, outcome, published_body
     from posts where workspace_id = ?1 and created_at >= ?2
       and (outcome is null or outcome != 'rejected')
     order by created_at desc`,
  )
    .bind(workspaceId, since)
    .all<PostRow>()

  const quiet = await c.env.DB.prepare(
    `select reason, call_count, created_at from quiet_weeks
     where workspace_id = ?1 and created_at >= ?2 order by created_at desc limit 1`,
  )
    .bind(workspaceId, since)
    .first<{ reason: string; call_count: number; created_at: string }>()

  const callCount = await c.env.DB.prepare(
    `select count(*) as n from calls where workspace_id = ?1`,
  )
    .bind(workspaceId)
    .first<{ n: number }>()

  const profile = await loadProfile(c.env, workspaceId)

  return c.json({
    posts: posts ?? [],
    quiet: quiet ?? null,
    callsStored: callCount?.n ?? 0,
    profile: profile ? { who: profile.who, audience: profile.audience, fromCalls: profile.derivedFromCalls } : null,
    providerCapabilities: PROVIDER_CAPABILITIES,
  })
})

/** Pull new calls from every connected notetaker. In-request, on purpose. */
week.post('/sync', async (c) => {
  const workspaceId = await workspaceOf(c.req.raw, c.env)
  const providers = await syncActiveNotetakers(c.env, workspaceId)
  return c.json({ providers, providerCapabilities: PROVIDER_CAPABILITIES })
})

/**
 * The write. Reads whole transcripts, learns who this person is if it hasn't
 * yet, writes on THEIR Claude, judges on a cheaper call of the same
 * subscription, keeps what survives. Runs in-request so failure is visible —
 * the person is watching this happen.
 */
week.post('/write', async (c) => {
  const workspaceId = await workspaceOf(c.req.raw, c.env)
  const candidateLimit = evaluationCandidateLimit(c.req.query('candidates'))

  const cred = await loadCredential(c.env, workspaceId, 'claude')
  if (!cred) return c.json({ error: 'Sign in with Claude first — the writing runs on your plan.' }, 400)

  // Fresh material first; a stale pull is a quiet week that didn't need to be.
  const sync = await syncActiveNotetakers(c.env, workspaceId)

  const since = new Date(Date.now() - WEEK_MS).toISOString()
  const calls = await loadCalls(c.env, workspaceId, since, 12)
  if (calls.length === 0) {
    const storedThisWeek = await c.env.DB.prepare(
      `select count(*) as n from calls where workspace_id = ?1 and occurred_at >= ?2`,
    )
      .bind(workspaceId, since)
      .first<{ n: number }>()
    const hasReadableProvider = sync.some((result) => result.readReady && result.found > 0)
    const reason =
      (storedThisWeek?.n ?? 0) > 0
        ? 'Calls are stored for this week, but their transcripts could not be read. Reconnect the call recorder and try again.'
        : hasReadableProvider
          ? 'No readable calls landed in the last 7 days — nothing new to write from.'
          : 'Connect Fathom before writing. Gong and Fireflies can connect, but transcript reading is not ready yet.'
    return c.json({
      error: reason,
      sync,
      includedCalls: [],
      providerCapabilities: PROVIDER_CAPABILITIES,
    }, 400)
  }

  const includedCalls = calls.map((call) => ({
    id: call.id,
    title: call.title,
    occurredAt: call.occurredAt,
    source: call.source ?? 'unknown',
  }))

  try {
    // Learn who they are before the first write, from their own calls.
    let profile = await loadProfile(c.env, workspaceId)
    if (!profile) {
      const recent = calls.slice(0, PROFILE_CALLS)
      profile = await deriveProfile(judgeEngineFor(cred), recent)
      await saveProfile(c.env, workspaceId, profile)
    }

    const publishedExamples = await loadPublishedExamples(c.env, workspaceId)
    const result = await produce(cred, calls, {
      audience: audienceContext(profile),
      publishedExamples,
      candidateLimit,
    })

    for (const kept of result.kept) {
      await c.env.DB.prepare(
        `insert into posts (id, workspace_id, body, tension, call_ids, reach, craft, stranger_takeaway)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
        .bind(
          `post-${crypto.randomUUID()}`,
          workspaceId,
          kept.draft.body,
          kept.draft.tension,
          JSON.stringify(kept.draft.callIds),
          kept.verdict.reach,
          JSON.stringify(kept.verdict.craft),
          kept.verdict.strangerTakeaway,
        )
        .run()
    }

    if (result.kept.length === 0) {
      await c.env.DB.prepare(
        `insert into quiet_weeks (id, workspace_id, reason, call_count) values (?1, ?2, ?3, ?4)`,
      )
        .bind(`quiet-${crypto.randomUUID()}`, workspaceId, result.nothingBecause ?? 'Nothing cleared the bar.', calls.length)
        .run()
    }

    return c.json({
      wrote: result.kept.length,
      dropped: result.dropped.length,
      nothingBecause: result.nothingBecause ?? null,
      receipt: result.receipt,
      sync,
      includedCalls,
      providerCapabilities: PROVIDER_CAPABILITIES,
      profileLearned: profile.derivedFromCalls,
      candidateLimit: candidateLimit ?? 3,
    })
  } catch (err) {
    // Engine errors carry a human sentence and nothing else; anything else
    // gets a generic line rather than internals.
    if (err instanceof EngineError) return c.json({ error: err.message, sync, includedCalls }, 502)
    // Message only — our own error names, never content. Transcript text does
    // not travel in error messages anywhere in this codebase.
    console.error('write_failed', err instanceof Error ? err.message : String(err))
    return c.json({ error: 'The write didn’t finish. Nothing was lost — try again.', sync, includedCalls }, 500)
  }
})

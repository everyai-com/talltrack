import { open, seal, type Envelope } from '../crypto/envelope'
import type { CallInput } from '../writer'
import type { TranscriptResult } from '../ingest/types'

/**
 * Transcript storage. R2 holds the ciphertext, D1 holds the pointer and the
 * metadata needed to find it again. Transcript text never touches D1, never
 * touches a log, and never appears in an error message.
 */

export type Env = { DB: D1Database; TRANSCRIPTS: R2Bucket; MASTER_KEY: string }

export type CallRow = {
  id: string
  workspace_id: string
  source: string
  source_id: string
  title: string | null
  occurred_at: string
  r2_key: string
}

function callId(workspaceId: string, source: string, sourceId: string): string {
  return `${workspaceId}:${source}:${sourceId}`
}

function r2Key(workspaceId: string, id: string): string {
  return `${workspaceId}/calls/${encodeURIComponent(id)}.json`
}

export async function saveCall(env: Env, workspaceId: string, source: string, call: TranscriptResult): Promise<string> {
  const id = callId(workspaceId, source, call.externalId)
  const key = r2Key(workspaceId, id)

  const envelope = await seal(call.transcript, env.MASTER_KEY)
  await env.TRANSCRIPTS.put(key, JSON.stringify(envelope))

  // Re-ingesting the same call replaces it rather than duplicating: notetakers
  // re-deliver, and a duplicated call would be read twice by the writer and
  // silently double its weight.
  await env.DB.prepare(
    `insert into calls (id, workspace_id, source, source_id, title, occurred_at, r2_key)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     on conflict (workspace_id, source, source_id) do update set
       title = excluded.title, occurred_at = excluded.occurred_at, r2_key = excluded.r2_key`,
  )
    .bind(id, workspaceId, source, call.externalId, call.title, call.occurredAt, key)
    .run()

  return id
}

/** Calls in a window, transcripts decrypted, ready for the writer to read whole. */
export async function loadCalls(env: Env, workspaceId: string, sinceIso: string, limit = 25): Promise<CallInput[]> {
  const { results } = await env.DB.prepare(
    `select id, title, occurred_at, r2_key from calls
     where workspace_id = ?1 and occurred_at >= ?2
     order by occurred_at desc limit ?3`,
  )
    .bind(workspaceId, sinceIso, limit)
    .all<Pick<CallRow, 'id' | 'title' | 'occurred_at' | 'r2_key'>>()

  const calls = await Promise.all(
    (results ?? []).map(async (row) => {
      const obj = await env.TRANSCRIPTS.get(row.r2_key)
      if (!obj) return null
      const envelope = (await obj.json()) as Envelope
      return {
        id: row.id,
        title: row.title ?? 'Untitled call',
        occurredAt: row.occurred_at,
        transcript: await open(envelope, env.MASTER_KEY),
      } satisfies CallInput
    }),
  )

  return calls.filter((c): c is CallInput => c !== null)
}

/** Delete means delete: the object goes, then the row that points at it. */
export async function deleteCall(env: Env, workspaceId: string, id: string): Promise<void> {
  const row = await env.DB.prepare(`select r2_key from calls where workspace_id = ?1 and id = ?2`)
    .bind(workspaceId, id)
    .first<{ r2_key: string }>()
  if (row) await env.TRANSCRIPTS.delete(row.r2_key)
  await env.DB.prepare(`delete from calls where workspace_id = ?1 and id = ?2`).bind(workspaceId, id).run()
}

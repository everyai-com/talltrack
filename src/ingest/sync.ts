import { fetchTranscript, listCalls, type ComposioEnv, type Notetaker } from './composio'
import { saveCall, type Env as CallsEnv } from '../db/calls'
import { getNotetaker } from '../db/notetakers'

/**
 * Pull calls from a connected notetaker into encrypted storage.
 *
 * Runs in-request, never in waitUntil — callcraft's pipeline notes record
 * waitUntil silently killing backfills mid-run. A pull the user is watching
 * either finishes or fails where they can see it.
 */

export type Env = ComposioEnv & CallsEnv & Pick<Cloudflare.Env, 'DB'>

export type SyncResult = {
  found: number
  saved: number
  /** Individual failures don't abort the pull; they're counted and reported. */
  failed: number
}

/** Which of the listed calls aren't stored yet. Pure, so the dedup rule is testable. */
export function newExternalIds(
  listed: Array<{ externalId: string }>,
  existing: Set<string>,
): string[] {
  return listed.map((c) => c.externalId).filter((id) => id && !existing.has(id))
}

/**
 * The list endpoint is the source of truth for metadata; the transcript
 * endpoint often returns none (the first live sync produced ten calls all
 * titled "Untitled call", all dated today). Transcript text comes from the
 * transcript endpoint, everything else from the listing.
 */
export function mergeMeta<T extends { title: string; occurredAt: string; durationS: number; providerUrl: string | null }>(
  listed: T,
  fetched: { transcript: string },
): T & { transcript: string } {
  return { ...listed, transcript: fetched.transcript }
}

const MAX_PAGES = 4
const MAX_NEW_PER_SYNC = 40

export async function syncNotetaker(env: Env, workspaceId: string, provider: Notetaker): Promise<SyncResult> {
  const connection = await getNotetaker(env, workspaceId, provider)
  if (!connection || connection.status !== 'ACTIVE') return { found: 0, saved: 0, failed: 0 }

  const { results } = await env.DB.prepare(
    `select source_id from calls where workspace_id = ?1 and source = ?2`,
  )
    .bind(workspaceId, provider)
    .all<{ source_id: string }>()
  const existing = new Set((results ?? []).map((r) => r.source_id))

  let cursor: string | undefined
  let found = 0
  let saved = 0
  let failed = 0

  for (let page = 0; page < MAX_PAGES; page++) {
    const { calls, nextCursor } = await listCalls(env, provider, connection.connectedAccountId, cursor)
    found += calls.length

    const byId = new Map(calls.map((c) => [c.externalId, c]))
    for (const id of newExternalIds(calls, existing)) {
      if (saved + failed >= MAX_NEW_PER_SYNC) break
      try {
        const fetched = await fetchTranscript(env, provider, connection.connectedAccountId, id)
        // A call with no words is a recording glitch, not material.
        if (fetched.transcript.trim().length === 0) {
          failed++
          continue
        }
        const listed = byId.get(id)
        const transcript = listed
          ? { ...mergeMeta(listed, fetched), externalId: id }
          : fetched
        await saveCall(env, workspaceId, provider, transcript)
        existing.add(id)
        saved++
      } catch {
        failed++
      }
    }

    if (!nextCursor || saved + failed >= MAX_NEW_PER_SYNC) break
    cursor = nextCursor
  }

  return { found, saved, failed }
}

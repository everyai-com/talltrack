import { fetchTranscript, listCalls, NOTETAKERS, type ComposioEnv, type Notetaker } from './composio'
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
  provider: Notetaker
  /** Whether this provider can supply transcript material to the writer. */
  readReady: boolean
  found: number
  saved: number
  /** Individual failures don't abort the pull; they're counted and reported. */
  failed: number
  skippedReason?: string
}

export type ProviderCapability = {
  readReady: boolean
  reason: string | null
}

/** A green connection is not the same thing as a provider TallTrack can read. */
export const PROVIDER_CAPABILITIES: Record<Notetaker, ProviderCapability> = {
  fathom: { readReady: true, reason: null },
  gong: { readReady: false, reason: 'Gong can connect, but transcript reading is not built yet.' },
  fireflies: { readReady: false, reason: 'Fireflies can connect, but transcript reading is not built yet.' },
}

export function providerCapability(provider: Notetaker): ProviderCapability {
  return PROVIDER_CAPABILITIES[provider]
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
  const capability = providerCapability(provider)
  if (!capability.readReady) {
    return {
      provider,
      readReady: false,
      found: 0,
      saved: 0,
      failed: 0,
      skippedReason: capability.reason ?? undefined,
    }
  }

  const connection = await getNotetaker(env, workspaceId, provider)
  if (!connection || connection.status !== 'ACTIVE') return { provider, readReady: true, found: 0, saved: 0, failed: 0 }

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

  return { provider, readReady: true, found, saved, failed }
}

/** Sync every active provider and preserve a visible result for each one. */
export async function syncActiveNotetakers(env: Env, workspaceId: string): Promise<SyncResult[]> {
  return Promise.all(NOTETAKERS.map((provider) => syncNotetaker(env, workspaceId, provider)))
}

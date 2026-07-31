import type { CallMeta, TranscriptResult } from './types'
import { segmentsToText, toMeta, type FathomMeeting, type FathomSegment } from './fathom'

/**
 * Notetaker connections via Composio.
 *
 * Composio hosts the sign-in (OAuth or key entry) and vaults the credential.
 * TallTrack stores only the connected-account id and asks Composio to make the
 * calls, so a notetaker's raw key never touches this code and never lands in
 * our database. That is the entire reason this layer exists rather than each
 * provider being wired directly.
 *
 * Ported from callcraft's src/ingest/composio.ts, which runs in production.
 */

const BASE = 'https://backend.composio.dev/api/v3'

export type ComposioEnv = Pick<
  Cloudflare.Env,
  | 'COMPOSIO_API_KEY'
  | 'COMPOSIO_FATHOM_AUTH_CONFIG'
  | 'COMPOSIO_GONG_AUTH_CONFIG'
  | 'COMPOSIO_FIREFLIES_AUTH_CONFIG'
>

export const NOTETAKERS = ['fathom', 'gong', 'fireflies'] as const
export type Notetaker = (typeof NOTETAKERS)[number]

export function isNotetaker(v: unknown): v is Notetaker {
  return typeof v === 'string' && (NOTETAKERS as readonly string[]).includes(v)
}

export const NOTETAKER_LABEL: Record<Notetaker, string> = {
  fathom: 'Fathom',
  gong: 'Gong',
  fireflies: 'Fireflies',
}

export class ComposioError extends Error {}

function headers(env: ComposioEnv): Record<string, string> {
  return { 'x-api-key': env.COMPOSIO_API_KEY, 'content-type': 'application/json' }
}

function authConfig(env: ComposioEnv, provider: Notetaker): string {
  const id = {
    fathom: env.COMPOSIO_FATHOM_AUTH_CONFIG,
    gong: env.COMPOSIO_GONG_AUTH_CONFIG,
    fireflies: env.COMPOSIO_FIREFLIES_AUTH_CONFIG,
  }[provider]
  if (!id) throw new ComposioError(`${NOTETAKER_LABEL[provider]} isn’t set up yet on our side.`)
  return id
}

/** One click: mint a hosted sign-in link for this person and this provider. */
export async function createConnectLink(
  env: ComposioEnv,
  provider: Notetaker,
  userId: string,
): Promise<{ redirectUrl: string; connectedAccountId: string }> {
  const res = await fetch(`${BASE}/connected_accounts/link`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ auth_config_id: authConfig(env, provider), user_id: userId }),
  })
  if (!res.ok) throw new ComposioError(`Couldn’t start the ${NOTETAKER_LABEL[provider]} sign-in. Try again.`)

  const data = (await res.json()) as { redirect_url?: string; connected_account_id?: string }
  if (!data.redirect_url || !data.connected_account_id)
    throw new ComposioError(`Couldn’t start the ${NOTETAKER_LABEL[provider]} sign-in. Try again.`)

  return { redirectUrl: data.redirect_url, connectedAccountId: data.connected_account_id }
}

/**
 * Status of ONE exact approval.
 *
 * Deliberately matched on id AND auth config rather than taking the first item
 * back: the list endpoint can return other accounts, and treating any of them
 * as "connected" would show a green tick for an account this person never
 * approved.
 */
export async function accountStatus(
  env: ComposioEnv,
  provider: Notetaker,
  userId: string,
  connectedAccountId: string,
): Promise<string> {
  const cfg = authConfig(env, provider)
  const params = new URLSearchParams({
    user_ids: userId,
    toolkit_slugs: provider,
    connected_account_ids: connectedAccountId,
    auth_config_ids: cfg,
    limit: '1',
  })

  const res = await fetch(`${BASE}/connected_accounts?${params}`, { headers: headers(env) })
  if (!res.ok) throw new ComposioError('Couldn’t check that connection. Try again.')

  const data = (await res.json()) as {
    items?: Array<{ id?: string; status?: string; auth_config?: { id?: string } }>
  }
  const exact = (data.items ?? []).find((i) => i.id === connectedAccountId && i.auth_config?.id === cfg)
  return exact?.status ?? 'NONE'
}

export function isConnected(status: string): boolean {
  return status.toUpperCase() === 'ACTIVE'
}

/** Composio injects the vaulted credential; raw provider keys never reach us. */
async function proxy(
  env: ComposioEnv,
  connectedAccountId: string,
  url: string,
  method = 'GET',
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${BASE}/tools/execute/proxy`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ connected_account_id: connectedAccountId, endpoint: url, method, ...(body ? { body } : {}) }),
  })
  if (!res.ok) throw new ComposioError('Couldn’t reach your notetaker. Try again.')

  const data = (await res.json()) as { data?: unknown; error?: unknown; status?: number }
  if (data.error) throw new ComposioError('Your notetaker rejected that request. Reconnect it.')
  // The proxy returns 200 even when the provider itself errored — the provider's
  // status rides inside the body. Without this check a 404 "succeeds" silently.
  if (typeof data.status === 'number' && data.status >= 400)
    throw new ComposioError('Your notetaker rejected that request. Reconnect it.')

  return data.data
}

/**
 * `fathom.video`, NOT `api.fathom.ai`.
 *
 * Composio's proxy enforces same-registrable-domain against the toolkit's base
 * URL, so api.fathom.ai returns a 400 from the proxy rather than from Fathom.
 * callcraft relearned this on 2026-07-21 after every poll had been silently
 * failing for a day. Do not "fix" this to match Fathom's own documentation.
 */
const FATHOM_BASE = 'https://fathom.video/external/v1'

type MeetingsResponse = { items?: FathomMeeting[]; meetings?: FathomMeeting[]; next_cursor?: string | null }
type TranscriptResponse = { meeting?: FathomMeeting; transcript?: FathomSegment[]; items?: FathomSegment[] }

export async function listCalls(
  env: ComposioEnv,
  provider: Notetaker,
  connectedAccountId: string,
  cursor?: string,
): Promise<{ calls: CallMeta[]; nextCursor: string | null }> {
  if (provider !== 'fathom')
    throw new ComposioError(`Reading calls from ${NOTETAKER_LABEL[provider]} isn’t built yet.`)

  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=25` : '?limit=25'
  const data = (await proxy(env, connectedAccountId, `${FATHOM_BASE}/meetings${qs}`)) as MeetingsResponse
  const items = data?.items ?? data?.meetings ?? []

  return {
    calls: items.map(toMeta).filter((c) => c.externalId),
    nextCursor: data?.next_cursor ?? null,
  }
}

export async function fetchTranscript(
  env: ComposioEnv,
  provider: Notetaker,
  connectedAccountId: string,
  externalId: string,
): Promise<TranscriptResult> {
  if (provider !== 'fathom')
    throw new ComposioError(`Reading calls from ${NOTETAKER_LABEL[provider]} isn’t built yet.`)

  const data = (await proxy(
    env,
    connectedAccountId,
    `${FATHOM_BASE}/recordings/${encodeURIComponent(externalId)}/transcript`,
  )) as TranscriptResponse

  return {
    ...toMeta(data?.meeting ?? {}),
    externalId,
    transcript: segmentsToText(data?.transcript ?? data?.items ?? []),
  }
}

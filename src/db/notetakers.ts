import type { Notetaker } from '../ingest/composio'

/**
 * Notetaker connections. Only Composio's connected-account id is stored — the
 * provider credential lives in Composio's vault, so a leak of this table
 * exposes an opaque id and nothing usable.
 */

export type Env = Pick<Cloudflare.Env, 'DB'>

export type NotetakerConnection = {
  provider: Notetaker
  connectedAccountId: string
  status: 'PENDING' | 'ACTIVE'
  connectedAt: string | null
}

/**
 * Written when the link is minted, before the person has approved anything.
 * Without this row there is nothing to poll against once they come back from
 * the other tab — the id would only exist in a browser variable that a refresh
 * would destroy.
 */
export async function markPending(
  env: Env,
  workspaceId: string,
  provider: Notetaker,
  connectedAccountId: string,
): Promise<void> {
  await env.DB.prepare(
    `insert into notetakers (workspace_id, provider, connected_account_id, status, connected_at)
     values (?1, ?2, ?3, 'PENDING', null)
     on conflict (workspace_id, provider) do update set
       connected_account_id = excluded.connected_account_id,
       status = 'PENDING', connected_at = null`,
  )
    .bind(workspaceId, provider, connectedAccountId)
    .run()
}

export async function markActive(env: Env, workspaceId: string, provider: Notetaker): Promise<void> {
  await env.DB.prepare(
    `update notetakers set status = 'ACTIVE', connected_at = ?3
     where workspace_id = ?1 and provider = ?2`,
  )
    .bind(workspaceId, provider, new Date().toISOString())
    .run()
}

export async function getNotetaker(
  env: Env,
  workspaceId: string,
  provider: Notetaker,
): Promise<NotetakerConnection | null> {
  const row = await env.DB.prepare(
    `select provider, connected_account_id, status, connected_at
     from notetakers where workspace_id = ?1 and provider = ?2`,
  )
    .bind(workspaceId, provider)
    .first<{
      provider: Notetaker
      connected_account_id: string
      status: 'PENDING' | 'ACTIVE'
      connected_at: string | null
    }>()

  if (!row) return null
  return {
    provider: row.provider,
    connectedAccountId: row.connected_account_id,
    status: row.status,
    connectedAt: row.connected_at,
  }
}

export async function listNotetakers(env: Env, workspaceId: string): Promise<NotetakerConnection[]> {
  const { results } = await env.DB.prepare(
    `select provider, connected_account_id, status, connected_at
     from notetakers where workspace_id = ?1`,
  )
    .bind(workspaceId)
    .all<{
      provider: Notetaker
      connected_account_id: string
      status: 'PENDING' | 'ACTIVE'
      connected_at: string | null
    }>()

  return (results ?? []).map((r) => ({
    provider: r.provider,
    connectedAccountId: r.connected_account_id,
    status: r.status,
    connectedAt: r.connected_at,
  }))
}

export async function removeNotetaker(env: Env, workspaceId: string, provider: Notetaker): Promise<void> {
  await env.DB.prepare(`delete from notetakers where workspace_id = ?1 and provider = ?2`)
    .bind(workspaceId, provider)
    .run()
}

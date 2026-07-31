import { open, seal, type Envelope } from '../crypto/envelope'
import type { EngineCredential, EngineName } from '../engine'
import { refreshClaudeToken, type ClaudeTokens } from '../providers/claude-oauth'

/**
 * Connected engines. Credentials are envelope-encrypted at rest exactly like a
 * transcript — a bearer token on someone's paid subscription is worse to lose
 * than a call recording.
 */

export type Env = Pick<Cloudflare.Env, 'DB' | 'MASTER_KEY'>

export type CredentialKind = 'subscription' | 'api_key'

export type Connection = {
  engine: EngineName
  kind: CredentialKind
  hint: string
  connectedAt: string
  /** True when a refresh is due. The UI shows this rather than a raw timestamp. */
  needsRefresh: boolean
}

type SealedTokens = { accessToken: string; refreshToken?: string }

function hintOf(token: string): string {
  return `…${token.slice(-4)}`
}

export async function saveConnection(
  env: Env,
  workspaceId: string,
  engine: EngineName,
  kind: CredentialKind,
  tokens: ClaudeTokens,
): Promise<Connection> {
  const payload: SealedTokens = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }
  const envelope = await seal(JSON.stringify(payload), env.MASTER_KEY)
  const hint = hintOf(tokens.accessToken)
  const connectedAt = new Date().toISOString()
  const expiresAt = tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : null

  await env.DB.prepare(
    `insert into connections (workspace_id, engine, kind, hint, sealed, connected_at, expires_at)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     on conflict (workspace_id, engine) do update set
       kind = excluded.kind, hint = excluded.hint, sealed = excluded.sealed,
       connected_at = excluded.connected_at, expires_at = excluded.expires_at`,
  )
    .bind(workspaceId, engine, kind, hint, JSON.stringify(envelope), connectedAt, expiresAt)
    .run()

  return { engine, kind, hint, connectedAt, needsRefresh: false }
}

/** What a screen may see: never the token, only enough to recognise it. */
export async function listConnections(env: Env, workspaceId: string): Promise<Connection[]> {
  const { results } = await env.DB.prepare(
    `select engine, kind, hint, connected_at, expires_at from connections where workspace_id = ?1`,
  )
    .bind(workspaceId)
    .all<{
      engine: EngineName
      kind: CredentialKind
      hint: string
      connected_at: string
      expires_at: string | null
    }>()

  return (results ?? []).map((r) => ({
    engine: r.engine,
    kind: r.kind,
    hint: r.hint,
    connectedAt: r.connected_at,
    needsRefresh: r.expires_at !== null && Date.parse(r.expires_at) <= Date.now(),
  }))
}

/**
 * Decrypted only at the moment of use, and refreshed in place when it has
 * expired. Refreshing here rather than on a schedule means a token that went
 * stale overnight is renewed by the run that needs it, not by a cron nobody
 * notices has stopped.
 */
export async function loadCredential(
  env: Env,
  workspaceId: string,
  engine: EngineName,
): Promise<EngineCredential | null> {
  const row = await env.DB.prepare(
    `select kind, sealed, expires_at from connections where workspace_id = ?1 and engine = ?2`,
  )
    .bind(workspaceId, engine)
    .first<{ kind: CredentialKind; sealed: string; expires_at: string | null }>()

  if (!row) return null

  const tokens = JSON.parse(await open(JSON.parse(row.sealed) as Envelope, env.MASTER_KEY)) as SealedTokens
  const expired = row.expires_at !== null && Date.parse(row.expires_at) <= Date.now()

  if (expired && tokens.refreshToken && engine === 'claude') {
    const fresh = await refreshClaudeToken(tokens.refreshToken)
    await saveConnection(env, workspaceId, engine, row.kind, fresh)
    return { engine, secret: fresh.accessToken, kind: row.kind }
  }

  return { engine, secret: tokens.accessToken, kind: row.kind }
}

export async function disconnect(env: Env, workspaceId: string, engine: EngineName): Promise<void> {
  await env.DB.prepare(`delete from connections where workspace_id = ?1 and engine = ?2`)
    .bind(workspaceId, engine)
    .run()
}

import { open, seal, type Envelope } from '../crypto/envelope'
import type { EngineCredential, EngineName } from '../engine'
import { credentialHint, type ClaudeCredential } from '../providers/claude-credential'

/**
 * Connected engines. The credential is envelope-encrypted at rest exactly like
 * a transcript — it is a bearer token on someone's paid subscription, so losing
 * it is worse than losing a call.
 */

export type Env = Pick<Cloudflare.Env, 'DB' | 'MASTER_KEY'>

export type Connection = {
  engine: EngineName
  kind: 'subscription' | 'api_key'
  hint: string
  connectedAt: string
}

export async function saveConnection(
  env: Env,
  workspaceId: string,
  engine: EngineName,
  cred: ClaudeCredential,
): Promise<Connection> {
  const envelope = await seal(cred.secret, env.MASTER_KEY)
  const hint = credentialHint(cred)
  const connectedAt = new Date().toISOString()

  await env.DB.prepare(
    `insert into connections (workspace_id, engine, kind, hint, sealed, connected_at)
     values (?1, ?2, ?3, ?4, ?5, ?6)
     on conflict (workspace_id, engine) do update set
       kind = excluded.kind, hint = excluded.hint,
       sealed = excluded.sealed, connected_at = excluded.connected_at`,
  )
    .bind(workspaceId, engine, cred.kind, hint, JSON.stringify(envelope), connectedAt)
    .run()

  return { engine, kind: cred.kind, hint, connectedAt }
}

/** What the UI is allowed to see: never the secret, only enough to recognise it. */
export async function listConnections(env: Env, workspaceId: string): Promise<Connection[]> {
  const { results } = await env.DB.prepare(
    `select engine, kind, hint, connected_at from connections where workspace_id = ?1`,
  )
    .bind(workspaceId)
    .all<{ engine: EngineName; kind: 'subscription' | 'api_key'; hint: string; connected_at: string }>()

  return (results ?? []).map((r) => ({
    engine: r.engine,
    kind: r.kind,
    hint: r.hint,
    connectedAt: r.connected_at,
  }))
}

/** Decrypted only at the moment of use, never held and never returned to a browser. */
export async function loadCredential(
  env: Env,
  workspaceId: string,
  engine: EngineName,
): Promise<EngineCredential | null> {
  const row = await env.DB.prepare(
    `select kind, sealed from connections where workspace_id = ?1 and engine = ?2`,
  )
    .bind(workspaceId, engine)
    .first<{ kind: 'subscription' | 'api_key'; sealed: string }>()

  if (!row) return null
  const secret = await open(JSON.parse(row.sealed) as Envelope, env.MASTER_KEY)
  return { engine, secret, kind: row.kind }
}

export async function disconnect(env: Env, workspaceId: string, engine: EngineName): Promise<void> {
  await env.DB.prepare(`delete from connections where workspace_id = ?1 and engine = ?2`)
    .bind(workspaceId, engine)
    .run()
}

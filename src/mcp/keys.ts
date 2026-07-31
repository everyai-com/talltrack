/**
 * Connector keys — how a Claude session proves it may read this workspace.
 *
 * The key is `tt_` + 32 random url-safe bytes, shown once, stored only as a
 * SHA-256 hash. It travels in the Authorization header exclusively; a key in a
 * URL is in logs and history the moment it is used (callcraft learned this in
 * production and removed its /mcp/<key> routes).
 */

export type Env = Pick<Cloudflare.Env, 'DB'>

function urlSafe(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return urlSafe(new Uint8Array(digest))
}

/** Creates (or replaces) the workspace's key. The returned string is the only copy that will ever exist. */
export async function issueKey(env: Env, workspaceId: string): Promise<string> {
  const key = `tt_${urlSafe(crypto.getRandomValues(new Uint8Array(32)))}`
  await env.DB.prepare(
    `insert into connector_keys (workspace_id, key_hash) values (?1, ?2)
     on conflict (workspace_id) do update set key_hash = excluded.key_hash,
       created_at = datetime('now'), last_used_at = null`,
  )
    .bind(workspaceId, await hashKey(key))
    .run()
  return key
}

export async function keyInfo(env: Env, workspaceId: string): Promise<{ createdAt: string; lastUsedAt: string | null } | null> {
  const row = await env.DB.prepare(
    `select created_at, last_used_at from connector_keys where workspace_id = ?1`,
  )
    .bind(workspaceId)
    .first<{ created_at: string; last_used_at: string | null }>()
  return row ? { createdAt: row.created_at, lastUsedAt: row.last_used_at } : null
}

export async function revokeKey(env: Env, workspaceId: string): Promise<void> {
  await env.DB.prepare(`delete from connector_keys where workspace_id = ?1`).bind(workspaceId).run()
}

/**
 * Bearer token → workspace id, or null. Touches last_used_at so the UI can
 * show "used 5 minutes ago" — the difference between "set up" and "working".
 */
export async function workspaceForKey(env: Env, authorization: string | undefined): Promise<string | null> {
  const match = /^Bearer\s+(tt_[A-Za-z0-9_-]{20,})$/.exec(authorization ?? '')
  if (!match) return null

  const hash = await hashKey(match[1]!)
  const row = await env.DB.prepare(
    `select workspace_id from connector_keys where key_hash = ?1`,
  )
    .bind(hash)
    .first<{ workspace_id: string }>()
  if (!row) return null

  await env.DB.prepare(
    `update connector_keys set last_used_at = datetime('now') where workspace_id = ?1`,
  )
    .bind(row.workspace_id)
    .run()
  return row.workspace_id
}

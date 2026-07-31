-- Keys for using TallTrack inside Claude (the MCP connector).
--
-- Only a SHA-256 hash is stored. The key itself is shown once at creation and
-- never again — a table leak yields nothing pasteable. Keys ride in the
-- Authorization header, never in the URL: callcraft shipped /mcp/<key> paths
-- first and removed them, because URLs land in server logs, browser history
-- and proxies, and a credential in any of those is already leaked.

create table if not exists connector_keys (
  workspace_id text primary key,
  key_hash     text not null,
  created_at   text not null default (datetime('now')),
  last_used_at text
);

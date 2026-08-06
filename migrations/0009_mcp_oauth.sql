-- MCP OAuth: the public front door for "just add the link in Claude".
--
-- A new person adds the MCP URL, Claude discovers the authorization server,
-- they approve in a browser, and a fresh workspace is created for them — no
-- form, no account step. Tokens are stored as SHA-256 hashes only, same rule
-- as connector_keys: the plaintext exists once, in the token response.

create table if not exists mcp_tokens (
  token_hash    text primary key,           -- SHA-256 of the access token
  refresh_hash  text unique,                -- SHA-256 of the refresh token
  workspace_id  text not null,
  client_id     text not null,
  expires_at    text not null,              -- ISO 8601
  created_at    text not null default (datetime('now')),
  last_used_at  text
);

create index if not exists mcp_tokens_by_workspace on mcp_tokens (workspace_id);

-- Workspaces created through OAuth. `solo` never appears here; it predates
-- multi-workspace and keeps its browser-cookie identity.
create table if not exists workspaces (
  id          text primary key,
  created_via text not null,                -- 'mcp-oauth'
  created_at  text not null default (datetime('now'))
);

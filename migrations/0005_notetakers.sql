-- Notetaker connections.
--
-- Only the Composio connected-account id is stored. The provider credential
-- itself lives in Composio's vault and is injected by their proxy at call time,
-- so a leak of this table exposes an opaque id and nothing usable.
--
-- `pending` rows exist because the approval happens in another tab: the row is
-- written when the link is minted, then promoted once Composio reports ACTIVE.
-- Without the pending row there is nothing to poll against after the redirect.

create table if not exists notetakers (
  workspace_id        text not null,
  provider            text not null,          -- fathom | gong | fireflies
  connected_account_id text not null,
  status              text not null,          -- PENDING | ACTIVE
  connected_at        text,
  created_at          text not null default (datetime('now')),
  primary key (workspace_id, provider)
);

-- Connected engines. `sealed` is an envelope-encrypted credential; `hint` is the
-- last four characters, which is all any screen is ever allowed to render.
--
-- `kind` matters on the wire, not just for display: a subscription token from
-- `claude setup-token` is sent as a bearer token with a beta header, an API key
-- is sent as x-api-key. Storing the kind is what keeps that decision from being
-- re-guessed at request time.

create table if not exists connections (
  workspace_id text not null,
  engine       text not null,              -- claude | codex
  kind         text not null,              -- subscription | api_key
  hint         text not null,
  sealed       text not null,
  connected_at text not null,
  primary key (workspace_id, engine)
);

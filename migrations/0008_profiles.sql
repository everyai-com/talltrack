-- Who this person is, learned from their own calls — not a form they filled in.
-- Feeds the writer (voice, audience) and the judge (who the stranger is).

create table if not exists profiles (
  workspace_id       text primary key,
  who                text not null,
  audience           text not null,
  voice              text not null default '',
  derived_from_calls integer not null,
  derived_at         text not null
);

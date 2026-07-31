-- The transcript is the unit. It is stored whole, encrypted, in R2; this table
-- holds only the pointer and the metadata needed to find it again. No transcript
-- text is ever written to D1. See docs/PLAN.md §5.1 and GT-2.

create table if not exists calls (
  id            text primary key,
  workspace_id  text not null,
  source        text not null,              -- fathom | gong | fireflies
  source_id     text not null,              -- the notetaker's own id
  title         text,
  occurred_at   text not null,              -- ISO 8601
  r2_key        text not null,              -- encrypted transcript object
  created_at    text not null default (datetime('now')),
  unique (workspace_id, source, source_id)
);

create index if not exists calls_by_workspace_time
  on calls (workspace_id, occurred_at desc);

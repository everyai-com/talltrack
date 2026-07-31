-- Posts the writer produced, and what the person did with them.
--
-- `outcome` is the whole taste loop. Callcraft's measured ceiling was 328 drafts
-- and zero verdicts, so this column existing is not enough — the product has to
-- make filling it a single tap on the screen the post is already on.

create table if not exists posts (
  id             text primary key,
  workspace_id   text not null,
  body           text not null,
  tension        text not null,
  call_ids       text not null,              -- json array
  reach          integer not null,
  craft          text not null,              -- json {mark: band}
  stranger_takeaway text,
  created_at     text not null default (datetime('now')),

  outcome        text,                       -- published | published_after_edit | rejected
  outcome_at     text,
  published_body text,                       -- what actually went out, when edited
  reject_reason  text
);

create index if not exists posts_by_workspace_time
  on posts (workspace_id, created_at desc);

-- Weeks that produced nothing. Kept deliberately: a run that returned zero is a
-- result, and without this row an empty week is indistinguishable from a week
-- that never ran.
create table if not exists quiet_weeks (
  id           text primary key,
  workspace_id text not null,
  reason       text not null,
  call_count   integer not null,
  created_at   text not null default (datetime('now'))
);

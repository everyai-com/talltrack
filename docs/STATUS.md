# Status

Living file. Read it first, update it on every material ship or blocker.

## 2026-07-31 — Phase S0 started: repo, Cloudflare project, walking skeleton

**Shipped**

- Repo created at `~/Desktop/talltrack`, git initialised on `main`.
- Cloudflare project stood up as its own thing, separate from AIOS. All names
  prefixed, because the account is shared with ~140 unrelated projects (the
  unprefixed `SESSIONS` KV name was already taken — that's why everything is
  `talltrack-*`).

  | Resource | Name | Binding | ID |
  |---|---|---|---|
  | D1 | `talltrack` | `DB` | `5060da2d-d066-4cb0-a1cb-abf2d7573358` |
  | KV | `talltrack-sessions` | `SESSIONS` | `a1f697802d284191828f70b33c83b262` |
  | R2 | `talltrack-transcripts` | `TRANSCRIPTS` | — |

- Walking skeleton: Hono Worker, `/api/health` that actually touches D1 rather
  than reporting that the binding object exists, React 19 + Vite client showing
  the honest-empty front door, D1 migration `0001_init` for `calls`.
- **`npm run check` green** — typecheck + build + 3 tests in the real Workers
  runtime.

**Toolchain notes worth keeping**

- `@cloudflare/vitest-pool-workers` 0.20 (Vitest 4) **removed
  `defineWorkersConfig`**. The runtime is now a Vite plugin:
  `plugins: [cloudflareTest({ wrangler: { configPath } })]` inside a normal
  `defineConfig`. Every tutorial online still shows the old shape.
- `wrangler types` **supersedes `@cloudflare/workers-types`** and the two
  conflict on peer ranges (pool 0.5.x pins wrangler 3 → types v4; wrangler 4
  wants types v5). Resolution: drop `@cloudflare/workers-types`, commit the
  generated `worker-configuration.d.ts`, and set `Env = Cloudflare.Env`.

**Not done**

- **GitHub remote.** `gh auth status` shows invalid keyring tokens for both
  `everyai-com` and `cryptophani`, so the remote could not be created. One
  `gh auth login` and one `gh repo create` finish it — see below.
- Nothing else from the plan. No ingestion, no writer, no judge, no auth.

**Next, in plan order**

1. **S0 — the bake-off corpus (GT-6).** 10 real transcripts + 10 posts Satya
   actually published, with a blind-presentation harness. **Nothing else starts
   until this exists**, because callcraft's quality failure was invisible for
   weeks for exactly the want of it.
2. **GT-3** — confirm the context ceiling a job gets on a user's own Claude or
   Codex. The whole thesis rests on holding full transcripts; if that ceiling is
   small, the plan changes shape and it's cheaper to know now.
3. S1 ingestion (Fathom), S2 the writer, then **G1 — beat callcraft on 7 of 10
   blind, before any screen exists.**

## 2026-07-31 (later) — The writer, the judge, and the bake-off

**Shipped**

- `src/writer/constitution.ts` — the editorial constitution. Seven laws, the AI
  tells to never write, and an explicit licence to return zero posts.
- `src/writer/write.ts` — one pass, whole transcripts, warm (temperature 1). A
  cold writer returns the median sentence. Caps at 3 drafts; volume is the enemy.
- `src/writer/quote-check.ts` — deterministic, not a model call. Every quoted span
  must appear in the transcript in order; ellipsis may elide a middle but cannot
  stitch unrelated fragments back to front.
- `src/writer/judge.ts` — stranger test (floor 6, can veto alone), craft as bands
  not decimals, drop-don't-revise. Judge runs at temperature 0 so a verdict does
  not flip between runs.
- `src/engine/` — Claude and Codex behind one interface, always the user's own
  credential, never a platform fallback. Judge deliberately uses a different,
  cheaper call than the writer.
- `src/ingest/fathom.ts`, `src/crypto/envelope.ts`, `src/db/calls.ts`, migration
  `0002_posts` — ported from callcraft, whose plumbing was never the problem.
- `scripts/bakeoff.ts` — G1, the kill gate, runnable before the product exists.
  `npm run bakeoff generate | pairs | score`.
- `MASTER_KEY` generated and set as a Worker secret; `.dev.vars` for local.

**39 tests, `npm run check` green.** App re-verified live after the schema and
secret changes: still healthy, no console errors.

**Three defects an adversarial pass caught and fixed** (all in `docs/DECISIONS.md`):
a module-local `Env` type that shadowed the real one and let `MASTER_KEY` be read
before it existed anywhere; a bare `Promise.all` over judgements that let one
rate-limit destroy drafts that had already passed; and a quote checker that
ignored quotes under 8 characters, which is exactly the band where fabrication
hides.

**Not wired end to end.** No routes call `produce` yet and the front door is still
the placeholder — S4 in the plan. The writer is reachable from tests and from the
bake-off harness, not from the browser.

## 2026-07-31 (later still) — Claude sign-in, and LIVE

**Live at https://talltrack.everyai-com.workers.dev** (Worker version
`f6de7ee6`). Health returns `{"ok":true}` with all three bindings wired;
migrations 0001-0003 applied to remote D1.

**Sign in with your own Claude.** Accepts the credential `claude setup-token`
mints — the same command and the same `sk-ant-oat01-` token AIOS uses, billing
the person's own subscription. Verified against Anthropic before storage,
envelope-encrypted at rest, only the last four characters ever reach a screen.

**Not the container capture AIOS uses.** AIOS drives the CLI inside a Sandbox
and scrapes the token off a rendered PTY; that needs a 539-line Python wrapper,
a container image, a Durable Object and a wrapper-hash handshake. TallTrack has
the person run the command and paste the result. Both produce the identical
credential, so `src/providers/claude-credential.ts` is the only file that
changes if the container flow is added later. The real cost is a trip to a
terminal — see `docs/DECISIONS.md`.

**48 tests, `npm run check` green.** Verified end to end in the browser against
the deployed Worker: a bad paste returns 400 and renders a human message, no
console errors.

## 2026-07-31 (final) — One-click sign-in, live

Worker version `75d7b886` at https://talltrack.everyai-com.workers.dev.

**Sign in with Claude is one button.** It opens Anthropic's approval page in a
new tab; approve, paste the short code back, done. No terminal, no container.
PKCE runs in the Worker (ported from callcraft's `src/llm/engine.ts`), the
verifier never leaves the server, and the resulting credential is the same
subscription token `claude setup-token` produces.

Superseded the paste-a-setup-token flow from earlier the same day, which worked
but sent people to a shell.

**Refresh tokens are stored and renewed at the moment of use.** Subscription
tokens are short-lived; without this the product works for an hour and then
quietly stops — which reads as "it broke", not "sign in again".

48 tests, `npm run check` green. Verified against the deployed Worker: the
authorize URL has the right client, `code=true` and an S256 challenge; expired
and unknown sign-ins each return their own human message; no console errors.

## 2026-07-31 (notetakers) — Fathom / Gong / Fireflies one-click connect, live

Worker version `822e913e`. All three notetakers connect through Composio's
hosted sign-in, reusing callcraft's API key and auth configs (now Worker
secrets). One click opens `connect.composio.dev`, the page polls until the
exact account reports ACTIVE, pending rows survive a refresh. Verified live:
all three mint real links, unknown providers 404, poll returns PENDING, delete
cleans up. 56 tests, `npm run check` green, no console errors.

Ported the three production-learned gotchas with their comments: the
fathom.video proxy-domain rule, the proxy's 200-with-inner-error shape, and
exact-account matching on status polls. Gong/Fireflies are connect-only until
their read paths land (S1).

## 2026-07-31 (direct sign-ins) — Gong OAuth + Fireflies native, live

Worker version `fbb91064`. All three notetakers are now true one-click sign-ins:

- **Fathom** — Composio hosted (was already OAuth). **Connected for real** on the
  founder workspace at 13:44 — the first live external connection.
- **Gong** — new Composio-managed OAUTH2 auth config `ac_YnJc4X-_BPJX`; the old
  key-mode config was the only reason it showed a key form.
- **Fireflies** — native OAuth 2.1 against its MCP server (ported from
  callcraft): dynamic client registration, PKCE, RFC 8707 resource binding,
  callback on our Worker, sealed grant in the new `sealed` column.

Verified live: Fireflies mints a real client and its authorize URL carries the
prod callback + MCP resource; Gong mints on the new config; a replayed callback
reads "expired" rather than double-exchanging. 60 tests, `npm run check` green,
no console errors.

## 2026-07-31 (inside Claude) — MCP connector live

Worker version `01043a92`. "Use it inside Claude" card mints a `tt_` key (shown
once, stored as SHA-256) and the paste-able one-liner:

    claude mcp add talltrack --transport http https://talltrack.everyai-com.workers.dev/mcp --header "Authorization: Bearer tt_…"

Four tools — `this_week`, `read_call`, `writing_guide`, `save_post` — on a
stateless hand-rolled JSON-RPC endpoint (~200 lines; callcraft's SDK+DO version
is 2,127). Inside Claude, Claude is the writer: the tools serve whole
transcripts and the constitution, and take approved posts back to the front
door. Verified live end to end: 401 with a human sentence when unauthenticated,
initialize/tools-list/all four tools green against prod, empty week answered
honestly.

Tests now apply D1 migrations to the per-run test database
(readD1Migrations → TEST_MIGRATIONS binding → test/setup.ts), which unlocked
integration-testing every DB-touching route. 72 tests.

Claude Code today; claude.ai web connectors need an OAuth server on our side —
queued behind proving the loop.

## 2026-07-31 (THE LOOP CLOSED) — first real posts, written from real calls

Worker version `0f4a2a6a`. **The product works end to end on real data:**
connect Fathom (one click) → 10 real calls ingested encrypted → profile derived
from 5 of them (who / audience / voice, from the transcripts) → **Opus 5 read
68,107 tokens of real transcript and wrote 2 posts → both cleared the judge
(reach 7) → both on the front door.** No manufactured third post. Cost receipt:
68,107 in / 9,043 out on the founder's own subscription.

Getting there surfaced four provider behaviours (CLI identity block, mandatory
streaming, 40k thinking floor, temperature 400s on Claude 5) and one Fathom
shape (transcript endpoint carries no metadata) — all in DECISIONS.md.

83 tests, `npm run check` green. Front door verified live: posts render, copy
works, console clean.

## 2026-08-01 — Reliability and quality loop implemented locally

**Shipped locally, not deployed:**

- Provider capability contract and all-provider sync summaries. Fathom is the
  only read-ready writer source; Gong and Fireflies are visible as connect-only.
- One editorial context builder shared by the Worker writer and MCP, including
  the AIOS style/reference assets, derived audience/voice, and published examples.
- `POST /api/posts/:id/outcome` plus front-door actions for published,
  published-after-edit, and rejected. Published text feeds future runs.
- Run preflight summary: included calls, provider found/saved/failed counts,
  model, token receipt, and the exact zero reason.
- Optional `TALLTRACK_ACCESS_TOKEN` browser gate with signed HttpOnly sessions;
  local tests retain the isolated `solo` identity.
- Regression coverage for auth, provider readiness, context parity, outcomes,
  and workspace scoping. `npm run check` is green: 15 test files, 102 tests;
  local Worker/Vite endpoint smoke is also green.

**Still blocked on founder input:** the private bake-off corpus is empty. The
10 real transcripts, 10 genuinely published posts, and comparable prior outputs
must come from Satya. The explicitly approved live evaluation is recorded below;
there was no production deploy. Set `TALLTRACK_ACCESS_TOKEN` in production
before the next deploy.

## 2026-08-01 — Fathom reconnect bug diagnosed

The live Fathom row was restored to its previously verified ACTIVE account after
the reconnect path was reproduced. The route fix is local and covered by a
regression test: an ACTIVE provider now returns a clear 409 instead of replacing
the working account with PENDING. The Worker was not redeployed.

## 2026-08-01 — Callcraft structural corpus integrated locally

TallTrack now uses Callcraft's generated, privacy-safe reference blueprints:
24 abstract shapes covering story, argument, process, list, proof, and lesson
movements. The writer chooses and locks one shape per story, carries its beat
map and evidence role into the paid write, and falls back deterministically if
the model returns no valid blueprint id. Raw Callcraft CSVs and creator post
bodies are not shipped or sent to the model.

`npm run check` is green: 16 test files, 103 tests. This is local only; no
Worker deploy and no additional paid write were triggered.

## 2026-08-01 — Approved Callcraft/TallTrack evaluation run

Added an explicit evaluation override: the normal weekly cap remains three,
while `?candidates=4` or `?candidates=5` is available only for a bounded
founder comparison. The full path still runs: Callcraft blueprint selection,
one writer per candidate, cut, quote safety, and independent judging.

Satya approved a real evaluation against the connected Fathom workspace. Two
remote-preview requests returned 504 to the client but continued server-side;
they saved four judged drafts. A final local Worker run with remote D1/R2/KV
bindings completed in 255 seconds and saved two more, dropping two. The six
new drafts are private and unpublished. The completed run receipt was Claude
Opus 5, 412,561 input tokens and 15,091 output tokens; Fathom found 40 calls,
with 11 calls included in the seven-day window. No public deploy was made.

## 2026-08-01 — AIOS-first writing path implemented locally

The production writer no longer injects Callcraft's template lock, 27-post
library, or 24 structural blueprints. It now makes one full-transcript writing
call using the AIOS LinkedIn/humanization guide, constitution, founder exemplar,
derived audience, and approved published examples. The prose body stays outside
JSON in a tagged contract, so the model can write naturally while TallTrack
still records tension and exact call receipts.

The separate judge, quote check, dequote safety repair, outcome loop, provider
sync, and token receipt remain in place. Normal weekly output is still capped at
three; four or five remains evaluation-only. `npm run check` is green: 16 test
files, 104 tests. This is local only and has not triggered another paid run or a
Worker deploy.

## 2026-08-01 — Private bake-off corpus prepared locally

`npm run bakeoff:prepare` now assembles 10 transcript exports and 10 posts
authored by Satya into the ignored `corpus/` directory. The manifest preserves
source provenance without putting transcript or post bodies in logs or git.
The harness now separates founder comparisons (`pairs published`) from the G1
Callcraft comparison (`pairs callcraft`). The latter stays unavailable until
same-call Callcraft outputs exist; the third-party creator CSVs are not a valid
substitute.

The approved generation could not start because this local TallTrack checkout
has no Claude/API credential in `.dev.vars`. No paid request was sent. Once a
Claude credential is connected, `npm run bakeoff -- generate` will write private
results to `corpus/out/` only.

## 2026-08-01 — Local Claude test link ready

Added a guarded local demo seed so Fathom is not required for dogfood. The local
Worker is running at `http://localhost:8787`, with 10 private transcript calls
loaded into local encrypted storage. `/api/week` confirms `callsStored: 10`, and
Claude OAuth start returns successfully. The seed route is unreachable unless
the local Worker is started with `TALLTRACK_DEMO_MODE=1`; it is not a production
feature.

Codex has an engine adapter, but its account-connection UI is not wired yet, so
the test link intentionally exercises the supported Claude path rather than
pretending Codex is ready in the browser.

The installed Claude Code CLI is present at version 2.0.10 and passed a
minimal authenticated `READY` check. `npm run bakeoff:claude -- 1` runs one
private smoke candidate through the real TallTrack writer and separate judge;
`-- 10` runs the full corpus. No API key needs to be copied into `.dev.vars`.
The first smoke attempt reached Claude's account cap before generation:
`Spending cap reached resets 3:30pm`. The harness now surfaces that provider
message directly and exits without writing a partial result.

## Owed

- [ ] GitHub remote (blocked on `gh auth login`)
- [ ] `docs/PLAN.md` GT-1…GT-6 all still unverified

## 2026-08-06 — Shape law from the 3,152-post creator corpus, all levels

The founder rejected the MCP-written posts as "not human like" and directed
building on callcraft's ACX creator corpus (~3,150 posts with engagement
data). Measured the top 300 by likes against our output: the miss was
physical shape (44-char one-line hooks and 91% short lines vs our dense
paragraphs), not word choice. Shipped locally: compiled 24-post shape
library (top 8 per creator, `npm` script + generated module), SHAPE_LAW in
the shared editorial context (browser writer and MCP `writing_guide`
identical), deterministic `shape-check.ts` wired into MCP `save_post`
(essays rejected with specific misses), and `/api/week` no longer returns
rejected posts. Verified live: guide serves shape law + 24 references, an
essay body is refused with actionable feedback, three reshaped posts
(hooks 35–56 chars, 100% short lines) saved through MCP and rendering on
the front door. `npm run check` green: 106 tests. Local only, no deploy.

## 2026-08-06 (deployed) — Shape-law writer, richer MCP, front-door polish, access gate LIVE

Worker version `f48f3765` at https://talltrack.everyai-com.workers.dev.
Deployed everything since 2026-08-01 plus today's shape work: shape law +
24-reference library in the shared context, shape-checked MCP `save_post`,
richer `this_week`/`read_call` (source, char counts, standing instructions
in-band), front-door post cards (tension overline, date + character meta,
phone-width reading column), and rejected posts filtered from `/api/week`.
`TALLTRACK_ACCESS_TOKEN` generated and set as a Worker secret before the
deploy — verified live: unauthenticated `/api/week` 401s, the login
exchange sets the signed cookie, and the authenticated week returns the
production workspace (42 calls, profile present). 106 tests green.

## 2026-08-06 (public MCP) — OAuth onboarding LIVE: add the link, approve, it works

Worker version `692eee4f`. The MCP connector is now a public front door:
`claude mcp add talltrack --transport http https://talltrack.everyai-com.workers.dev/mcp`
with NO key. The 401 carries WWW-Authenticate discovery; Claude registers a
client (DCR, public, PKCE S256), the person clicks one Approve on a hosted
consent page, and a fresh isolated `ws-…` workspace is created — the
approval IS the account. Tokens (30d access + refresh) stored as SHA-256 in
new `mcp_tokens`; migration 0009 applied remotely. Two new MCP tools —
`connect_notetaker` (mints the Composio hosted sign-in link for Fathom/Gong
in the caller's own workspace) and `notetaker_status` (confirms approval,
flips ACTIVE, syncs calls in immediately). Fireflies stays web-only (its
callback flow) and says so. Verified live end to end: discovery → DCR →
consent (screenshot) → approve → token (+refresh) → this_week in the fresh
empty workspace answering honestly, all six tools listed. Code replay
returns 400. 109 tests, `npm run check` green. Existing tt_ keys keep
working unchanged.

## 2026-08-07 — /start: the stuck-proof onboarding path, LIVE

Worker version `403b894d`. A real tester hit the OAuth wall from a
non-interactive Claude session (screenshot from the founder), so onboarding
now has a path that works in EVERY session type: https://…/start is a
public one-click page that mints a fresh workspace + connector key and
hands back the complete `claude mcp add … --header` command (key shown
once, stored as SHA-256, 20 mints/IP/day). The MCP now guides from inside
too: `initialize` returns server instructions, the empty `this_week` tells
Claude to offer `connect_notetaker`, and the 401 names both paths (/mcp
sign-in for interactive sessions, /start for everything else). Verified
live: page renders, click mints, the minted command's key opens the MCP on
a fresh honest-empty workspace. 111 tests green.

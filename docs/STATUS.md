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

## Owed

- [ ] GitHub remote (blocked on `gh auth login`)
- [ ] `docs/PLAN.md` GT-1…GT-6 all still unverified

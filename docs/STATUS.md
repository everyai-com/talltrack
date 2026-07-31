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

## Owed

- [ ] GitHub remote (blocked on `gh auth login`)
- [ ] `docs/PLAN.md` GT-1…GT-6 all still unverified

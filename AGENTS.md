# AGENTS.md — TallTrack

Canonical agent file. Any harness that reads `AGENTS.md` (Codex, Cursor, Copilot,
Gemini CLI, Zed, Cline, Windsurf, …) gets it directly; Claude Code imports it
through `CLAUDE.md`.

**Product:** sales calls in, content worth publishing out. Connect a notetaker
(Fathom first), log in with your own Claude or Codex, get one to three posts a
week you'd actually publish — and an honest "nothing this week" when there
wasn't a story in the calls.

**THE plan (source of truth):** `docs/PLAN.md`. Read it first, every session.
Its §0 — why callcraft's content isn't good — is the reason this project exists,
and every architectural choice here follows from it. Do not start work without
reading §0 and §4.

## The one thing that must not be forgotten

Callcraft is the same product, already built and deployed, whose content is not
good enough. It failed for architectural reasons, not prompt reasons:

- eight staged hand-offs meant **the writer never read the transcript**
- a claim ledger requiring every line to cite evidence **forbade every sentence
  that makes prose readable**
- salience ranking picked the most quotable thing, not the most interesting one
- always emitting a pack produced **328 drafts and 0 published**

So: **one agent, whole transcripts in context, one pass, a separate judge that is
allowed to return nothing.** If you find yourself adding a stage, extracting
"moments", ranking by score, or building a revision loop, stop — that is the
failure being rebuilt.

## Ground rules

- **Stack:** all Cloudflare. One Worker (Hono + TS) + D1 + R2 + KV; React 19 +
  Vite client served as Worker static assets. Separate CF project from AIOS.
- **Engine:** the user's own Claude or Codex. Never a platform key as a default
  or fallback. Long-context writing is only affordable because it runs on their
  subscription — that is the entire reason the architecture can be simple.
- **Transcripts:** envelope-encrypted in R2. No transcript text in D1, in logs,
  or in any error. Delete means delete. Non-negotiable.
- **Volume is the enemy.** Zero posts is a correct, shippable output. Never pad a
  week. Never revise a failed post — drop it.
- **Design:** warm dark, one accent, no gradients, nothing purple. Same shell as
  AIOS, only the screens this job needs. Three screens, no dashboard.
- **Origin workspace:** planned in `~/Desktop/AIOS_coding` — see its
  `context/decisions.md` (2026-07-31) for the reasoning behind every choice, and
  `plans/2026-07-31-aios-studio-content-from-calls.md` for the original plan.

## Harness support

TallTrack's MCP server is **remote** at `https://talltrack.everyai-com.workers.dev/mcp`
(streamable-http, OAuth discovery + optional `tt_…` bearer key). It works with any
remote MCP client; see the README "Install in your harness" section and the root
`server.json` for the registry manifest. This file is the standing instruction for
every harness.

## Commands

```bash
npm run dev          # Worker on :8787
npm run dev:web      # web client on :5173, proxying /api to the Worker
npm run check        # typecheck + build + tests — the gate, run before pushing
npm run types        # regenerate worker-configuration.d.ts after editing wrangler.jsonc
npm run deploy       # build + wrangler deploy
```

**`npm run check` must be green before any push.** After changing bindings in
`wrangler.jsonc`, run `npm run types` or the Worker's `Env` silently goes stale.

## Status

`docs/STATUS.md` and `docs/DECISIONS.md` — read both every session, update both on
every material ship or blocker. Stale status is worse than none.

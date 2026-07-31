# TallTrack

Sales calls in, content worth publishing out.

Connect your notetaker, log in with your own Claude or Codex, and get one to
three posts a week you'd actually publish — plus a straight answer on the weeks
there wasn't a story in the calls.

## Why this exists

The same product was built once already and its content wasn't good enough: 328
drafts, none published. The cause was architectural. Eight staged hand-offs meant
the writer never read the transcript — it wrote from a compression of a
compression. A claim ledger requiring every line to cite evidence forbade every
sentence that makes prose readable. And a system that always emits a pack emits
mediocrity on a quiet week.

TallTrack is the correction: **one agent, whole transcripts in context, one pass,
and a separate judge that's allowed to return nothing.** That is only affordable
because the writing runs on the user's own Claude or Codex subscription — which
is what removed the cost ceiling that forced the compression in the first place.

Full reasoning: [`docs/PLAN.md`](docs/PLAN.md) §0.

## Stack

One Cloudflare Worker (Hono + TypeScript) with D1, R2 and KV; a React 19 + Vite
client served as static assets from the same Worker. Transcripts are
envelope-encrypted in R2 — nothing readable is stored, and delete means delete.

## Getting started

```bash
npm install
npm run migrate:local
npm run dev
```

In a second terminal:

```bash
npm run dev:web
```

The client runs on `:5173` and proxies `/api` to the Worker on `:8787`. Point it
somewhere else with `TALLTRACK_API_TARGET`.

## The gate

```bash
npm run check
```

Typecheck, build, and tests. Green before every push, no exceptions. After
editing bindings in `wrangler.jsonc`, run `npm run types` to regenerate
`worker-configuration.d.ts` — otherwise the Worker's `Env` goes stale and a
missing binding shows up as `undefined` at runtime instead of as a type error.

## Where things are

| Path | What |
|---|---|
| `src/` | the Worker — Hono app, routes |
| `web/` | the React client |
| `migrations/` | D1 schema |
| `test/` | Worker tests, run in the real runtime via Miniflare |
| `docs/PLAN.md` | the plan and the reasoning. Read §0 and §4 first. |
| `docs/STATUS.md` | what's shipped, what's blocked |
| `docs/DECISIONS.md` | choices made, and alternatives rejected |

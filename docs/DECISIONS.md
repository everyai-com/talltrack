# Decisions

Append-only. Each entry records the choice, the alternatives rejected, and why —
the diff is in git, the reasoning isn't.

---

## 2026-07-31 — Standalone repo and Cloudflare project, not a surface inside `aios-core`

**Decision (Satya):** TallTrack gets its own folder, its own git repo, and its own
Cloudflare project.

**Rejected — building inside `aios-core`.** This was the original recommendation
and it still stands on the merits: `aios-core` already ships the web client, BYO
Claude/Codex login, auth, jobs, the runtime and the AIOS shell, so a separate repo
re-solves the four hardest problems and risks forking the design system. Overridden
because TallTrack is its own product with its own brand and billing, because
`aios-core` is mid-migration across a dozen worktrees and shouldn't take on a second
product surface right now, and because callcraft already proved a standalone Worker
carries this shape comfortably.

**The cost, accepted knowingly:** auth, engine login and the design system get built
here instead of inherited. Mitigation is to port the *patterns* from `aios-core` and
callcraft rather than reinvent them, and to keep the visual language identical so the
two never drift into different-looking products.

---

## 2026-07-31 — One-pass writer, not a staged pipeline

**Decision:** one agent reads whole transcripts and writes in one pass; a separate
judge may return nothing. No extraction, no moment records, no salience ranking, no
corpus window, no claim ledger, no revision loop.

**Why:** callcraft's content is bad because of these, not because of its prompts.
Its writer never saw a transcript; its claim ledger forbade every non-citable
sentence; its ranking picked the most quotable rather than the most interesting
thing; and always emitting a pack produced 328 drafts and 0 published. Full
diagnosis in `docs/PLAN.md` §0.

**Rejected:**
1. **Fixing callcraft's prompts.** Eighteen months of iteration produced 127 ready
   posts and 0 published. The prompts are careful; the architecture is the cause.
2. **Forking callcraft.** Its plumbing is good and gets ported. Its pipeline is the
   defect, and forking carries the defect.
3. **Keeping the claim ledger.** It makes fabrication structurally impossible and
   good writing structurally impossible with it. Replaced by a targeted quote check
   — every quoted span must appear verbatim in the transcript — plus
   drop-don't-revise. **This is a real trade, not an oversight:** fabrication moves
   from a guaranteed property to a checked one, and §10 of the plan requires
   measuring the fabrication rate against callcraft's at S3.
4. **Revision loops.** How 328 drafts happened. A post that fails is dropped.

**Why it's possible now and wasn't before:** compression existed to save cost and
context. On the user's own Claude or Codex subscription, a frontier model can hold
several full transcripts and think about them. The constraint that forced the
architecture is gone, so the architecture goes with it.

---

## 2026-07-31 — Name-prefix every Cloudflare resource

**Decision:** `talltrack`, `talltrack-sessions`, `talltrack-transcripts`.

**Why:** the account is shared with AIOS and roughly 140 unrelated projects.
Creating a KV namespace called `SESSIONS` failed on a name collision — which is the
cheap version of the same lesson. Bindings inside the Worker stay short and generic
(`DB`, `SESSIONS`, `TRANSCRIPTS`); only the global resource names are prefixed.

---

## 2026-07-31 — Generated runtime types, not `@cloudflare/workers-types`

**Decision:** `wrangler types` → committed `worker-configuration.d.ts`, and
`export type Env = Cloudflare.Env`.

**Why:** the two approaches conflict on peer ranges — `vitest-pool-workers` 0.5.x
pins wrangler 3 (types v4) while wrangler 4 wants types v5 — and wrangler now says
plainly that generated types supersede the package. The real win is that a binding
added to `wrangler.jsonc` but missing from `Env` becomes a type error instead of an
`undefined` at runtime.

**Cost:** `npm run types` must be re-run after any binding change. Recorded in
`CLAUDE.md` and `README.md` because it is exactly the kind of step that gets
forgotten once and then debugged for an hour.

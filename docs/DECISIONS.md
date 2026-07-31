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

---

## 2026-07-31 — Bindings and secrets derive from generated types, never module-local ones

**Decision:** `src/db/calls.ts` uses `Pick<Cloudflare.Env, …>`; secrets are declared
on `Cloudflare.Env` in `src/env.d.ts`; nothing hand-declares an `Env` shape.

**Why:** an adversarial pass found `src/db/calls.ts` reading `env.MASTER_KEY` when
`MASTER_KEY` existed nowhere — not in `wrangler.jsonc`, not as a secret, not in the
generated types. It typechecked perfectly, because the file declared its own local
`type Env = { …; MASTER_KEY: string }` which shadowed the real environment. At
runtime every transcript write would have failed. A module-local Env type is a
typecheck that validates itself.

**Also:** `MASTER_KEY` is now generated and set (`wrangler secret put`), with a
matching gitignored `.dev.vars`. Secrets can't appear in `wrangler.jsonc` because
that file is committed, which is exactly why they need declaring somewhere else
rather than being invented at the point of use.

---

## 2026-07-31 — One failed judgement never destroys the other drafts

**Decision:** each draft is judged inside its own try/catch. A draft whose verdict
can't be obtained is **dropped, not kept**, and the summary says "couldn't check
this one" rather than blaming fabrication.

**Why:** the first version judged with a bare `Promise.all`, so a single rate-limit
or malformed response rejected the whole batch and threw away drafts that had
already passed. Writing is the expensive step and judging is the cheap one —
losing good writing to a cheap hiccup is the worst trade in the product.

**Failing closed is deliberate.** Publishing something unjudged is precisely what
the judge exists to prevent, so an unreachable verdict must never default to keep.

---

## 2026-07-31 — Short quotes are checked too

**Decision:** the quote checker's lower bound is 4 characters, not 8.

**Why:** at 8, `he said "we lost"` — seven characters — was not checked at all.
Short quotes are the easiest to fabricate and the hardest to notice, which is the
opposite of what an unchecked band should contain.

---

## 2026-07-31 — Claude sign-in: same credential as AIOS, simpler capture

**Decision:** TallTrack accepts the credential `claude setup-token` mints — the
**same command and the same `sk-ant-oat01-…` token AIOS uses**, billing the
person's Claude subscription. The person runs the command and pastes the result.

**Rejected — porting AIOS's container capture.** `aios-core` drives the CLI
inside a Cloudflare Sandbox and scrapes the token off a rendered PTY. Faithfully
reproducing it needs a 539-line Python wrapper, a container image, a Durable
Object class, `standard-2` container instances, and a wrapper-hash handshake
that exists because `wrangler deploy` once reported success while leaving the
container pinned to the previous image. The comments in
`aios-core/src/providers/claude/auth.ts` are a catalogue of how much went wrong
getting it working: the TUI redraws by diff and corrupts the token mid-stream,
the CLI idles instead of exiting on a rejected code, silence has to be measured
from the last output *change* rather than from delivery.

**The distinction that makes this fine:** how a token is *captured* is separate
from how it is *used*. Both paths produce the identical credential, so
`src/providers/claude-credential.ts` is the only file that would change if the
container capture is added later. Nothing downstream of it knows the difference.

**What is genuinely lost:** the person leaves the browser for a terminal. For a
founder-facing product that is a real cost, and the container flow should
eventually land. It is not worth blocking the writer on today.

**Also decided:** the credential *kind* is stored, not re-guessed at request
time. A subscription token goes out as `Authorization: Bearer` plus
`anthropic-beta: oauth-2025-04-20`; an API key goes out as `x-api-key`. Sending
one as the other returns a 401 indistinguishable from a revoked credential.

**And:** the token is verified against Anthropic *before* being stored. A bad
token should fail on the screen where it can be fixed, not silently at 6am on
the first real run where the only symptom is an empty week.

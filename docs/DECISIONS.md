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

---

## 2026-07-31 — One-click sign-in: PKCE in the Worker, no terminal and no container

**Decision:** Sign in with Claude is one button. It opens Anthropic's approval
page in a new tab; the person approves, Anthropic shows a short code, they paste
it back, and the Worker exchanges it server-side. Ported from callcraft's
`src/llm/engine.ts`, which runs this flow in production.

**Supersedes** the paste-a-setup-token flow shipped earlier the same day.

**Why this beats both earlier options.** AIOS drives the CLI inside a Sandbox and
scrapes the token off a rendered PTY, which needs a container image, a Durable
Object, a 539-line PTY wrapper and a wrapper-hash handshake. The paste flow
needed no infrastructure but sent the person to a terminal. Running PKCE directly
in the Worker needs neither: no container, no CLI, no terminal — and it produces
the same subscription credential as both.

**The security rule that shapes the code:** the PKCE verifier never leaves the
Worker. It lives in KV under a server-issued opaque id and the browser only ever
sees that id. A verifier that reaches the browser turns PKCE back into a bare
redirect that anyone holding the code could complete. The `state` is compared in
constant time, and a pending sign-in is deleted whether the exchange succeeds or
fails, so a rejected code can't be replayed.

**Refresh tokens are stored, not just access tokens.** Subscription tokens are
short-lived; without refresh the product works for an hour and then quietly
stops, which reads to a user as "it broke" rather than "sign in again". The
refresh happens in `loadCredential` at the moment of use rather than on a
schedule — a token that went stale overnight is renewed by the run that needs it,
not by a cron nobody notices has stopped.

**Popup blockers.** `window.open` can be silently blocked, which would leave the
person holding a paste box and no tab to paste from. The authorize URL is kept in
state and offered as a plain link.

---

## 2026-07-31 — Notetakers connect through Composio, on callcraft's auth configs

**Decision:** Fathom, Gong and Fireflies connect via Composio's hosted sign-in.
One click mints a `connect.composio.dev` link; the person approves in the
provider's own UI; we poll Composio until the exact account reports ACTIVE. The
Composio API key and all three auth-config ids are **reused from callcraft** —
same master account, same toolkit configs, set as Worker secrets.

**Why Composio rather than direct OAuth per provider:** the provider credential
never touches our code. Composio vaults it and injects it at request time
through their proxy; we store only an opaque connected-account id. Three
providers' worth of OAuth apps, token refresh and key storage collapse into one
integration that callcraft already proved in production.

**Three ported gotchas that each cost callcraft real time:**
1. **`fathom.video`, not `api.fathom.ai`.** Composio's proxy enforces
   same-registrable-domain with the toolkit's base URL; the documented API host
   400s at the proxy. Every callcraft poll silently failed for a day
   (relearned 2026-07-21) before this was found.
2. **The proxy returns 200 when the provider errored** — the provider's status
   rides inside the body. Without checking it, a 404 "succeeds".
3. **Match the exact account id AND auth config when polling.** The list
   endpoint can return other accounts; taking the first item shows a green tick
   for an approval that never happened.

**Pending rows are written before the redirect,** because the approval finishes
in another tab. If the connected-account id lived only in a browser variable, a
refresh mid-approval would strand an account Composio considers live.

**Accepted trade:** reusing callcraft's Composio account means both products
share one vault and one billing relationship. Fine at this scale; split it if
TallTrack gets its own Composio org later — the auth-config ids are the only
thing that would change.

**Gong and Fireflies are connect-only today:** the sign-in works end to end, but
`listCalls`/`fetchTranscript` are Fathom-only and say so plainly rather than
pretending. The read path lands with S1 for each provider.

---

## 2026-07-31 — Gong and Fireflies become real sign-ins, two different ways

**The problem:** Composio's hosted page showed Gong and Fireflies as API-key
entry forms — the person had to go find a key. Not one click.

**Gong — a new Composio auth config, not new code.** The Gong toolkit supports
`OAUTH2` with a Composio-managed app; callcraft's config had simply been created
in key mode (its own decision log records "Basic-auth key+secret" as the v1.1
path). Created `ac_YnJc4X-_BPJX` via the API with managed auth and pointed
`COMPOSIO_GONG_AUTH_CONFIG` at it. Zero code changed; the same hosted link now
lands on Gong's real sign-in.

**Fireflies — callcraft's native MCP OAuth, ported.** Fireflies' regular API is
key-only, so Composio *cannot* offer OAuth for it. But Fireflies runs a public
remote MCP server with real OAuth 2.1 — dynamic client registration, PKCE,
refresh — and callcraft built and productionised a native flow against it. Ported
here: every sign-in registers its own public client (no client secret to hold),
the grant is bound to the MCP server via RFC 8707 `resource` (without it the
token "succeeds" and every later call 401s), and the callback lands on our
Worker, which answers in plain HTML.

**One deliberate simplification, recorded honestly:** callcraft's callback keeps
encrypted resumable checkpoints so a retry can survive a mid-flow crash without
re-exchanging the consumed single-use code. TallTrack instead deletes the
pending state BEFORE the exchange — a replayed callback finds nothing and reads
"expired", and a consumed code is never exchanged twice. The cost: a transient
exchange failure means redoing a ten-second flow. The win: ~100 fewer lines of
state machinery at a stage of the product where simplicity compounds.

**Rejected:** asking Fireflies/Gong users to paste API keys (the thing being
fixed); waiting for a Gong-approved partner app (callcraft's notes flag Gong
partner approval as a launch-blocking dependency — the managed Composio app
avoids it entirely).

---

## 2026-07-31 — Inside Claude, Claude is the writer

**Decision:** the MCP connector hands Claude the material — `this_week`,
`read_call` (whole transcripts), `writing_guide` (the constitution) — and takes
finished work back (`save_post`). It does NOT run the server-side writer.

**Why:** in a Claude conversation there is already a frontier model with the
person in the loop. Proxying a second model call through the Worker would cost
their subscription twice, add a two-minute silent wait inside a chat, and put
the writing behind a tool call instead of in the conversation where they can
steer it. The constitution travels as a tool result, so the same editorial law
governs both surfaces.

**Also decided:**
- **Hand-rolled JSON-RPC, not the agents SDK.** callcraft's SDK version is
  2,127 lines with a Durable Object per session. Four tools with a fixed
  contract need ~200 stateless lines and zero new dependencies. If the surface
  grows real sessions or streaming, revisit.
- **Keys in the Authorization header only, stored as SHA-256.** callcraft
  shipped `/mcp/<key>` URL auth first and removed it — URLs land in logs,
  history and proxies. The key is shown once at mint; rotation is the
  "I pasted it somewhere wrong" fix.
- **`save_post` requires a tension.** Law 2 survives the connector: if Claude
  can't name the one-sentence tension, the post doesn't get saved.
- **The tool descriptions carry the discipline** ("read every call in full
  before writing", "never save drafts on your own initiative", "no calls is a
  real answer — do not invent material") — inside Claude, descriptions are the
  only place standing instructions can live.

**Rejected:** exposing a `write_posts` tool that runs the server-side one-pass
writer (double-billing + silent wait, above); claude.ai web connectors (need an
OAuth server on our side — real work, queued behind proving the loop in Claude
Code); putting the key in the MCP URL.

---

## 2026-07-31 — The write path: sync → learn who you are → write → judge → front door

**Decision:** one route (`POST /api/week/write`) does the whole loop in-request:
pull fresh calls, derive the profile on first run (who they are, who they sell
to, how they talk — from their own transcripts, not a form), write on their
Claude, judge on a cheaper call of the same subscription, store what survives,
record the quiet week when nothing does.

**Proved live on the founder workspace:** 10 real Fathom calls ingested
encrypted, profile derived from 5, **Opus 5 read 68,107 tokens of transcript
and wrote 2 posts; both cleared the judge (reach 7)**; zero manufactured
third post. First real content on the front door.

**Four provider behaviours learned the expensive way (all now encoded in
src/engine/claude.ts, three of them ported from callcraft's engine after our
first write attempt failed):**
1. A subscription token is scoped to Claude Code — the CLI identity must be the
   FIRST system block or the call is rejected outright.
2. Always stream: long writes exceed the ~100s non-streaming edge timeout.
   A stream that ends without message_stop is treated as a failure — partial
   text must never reach the judge looking complete.
3. Opus 5 thinks by default and thinking spends max_tokens — floor the budget
   at 40k for sonnet/opus or the answer truncates mid-JSON.
4. **`temperature` is deprecated on Claude 5 models and 400s.** Discovered by
   probing prod directly: the temp-0 profile call died instantly with
   "`temperature` is deprecated for this model." Nothing sends temperature to
   Claude anymore; the judge's near-determinism now rests on its strict prompt
   and coarse bands, not sampling. Accepted trade.

**Also fixed from live data:** the Fathom transcript endpoint returns no
meeting metadata — the first sync produced ten calls all titled "Untitled call",
all dated today. The list endpoint is now the source of truth for metadata;
the transcript endpoint contributes only text.

**Known limit, not blocking:** 30 of 40 listed Fathom calls have no retrievable
transcript (shorts, unprocessed, or transcript-disabled). Counted and reported,
never guessed at.

---

## 2026-07-31 — The constitution alone was a distillation; the verbatim AIOS assets are the writer

**The founder's report:** "the content is not coming as good as the AIOS app."

**The diagnosis was already written.** callcraft hit this identical gap on
2026-07-19 and its memory records the finding twice over: AIOS posts beat
pipeline posts because AIOS holds the 190-line writing-style skill VERBATIM and
27 high-performing reference posts VERBATIM in context with a template lock —
and "when porting AIOS assets, keep the verbatim material in context;
distillation loses what makes it work." TallTrack's constitution was exactly
that mistake, made a third time: principles restated in my own words, zero
reference posts, and the publishedExamples hook wired but never fed.

**The fix, ported not rewritten:**
- `src/writer/style.ts` — callcraft's `prompts/style.ts` copied verbatim (it IS
  the AIOS writing-style SKILL.md, compiled, with provenance hashes). The
  standing rule carries over: re-port when the source changes, never fork.
- `src/writer/references.ts` — the 27 Suprava reference posts verbatim (~5k
  tokens) plus the template lock: pick the ONE best-fit reference, mirror its
  structural DNA, structure only — facts, numbers, offers, phrases, CTAs never
  transfer.
- Prompt order is deliberate: constitution (what a post IS, the licence to
  write nothing) → style law (HOW) → lock + library (the bar and the shapes).

**Measured on the same ten calls, same model, same profile:** v1 opened on
theses and wrote essay cadence ("Which inverts how this market looks from the
outside"); v2 opens on scenes ("At a startup fair in Hyderabad…"), carries real
speech ("caveman to Elon Musk in one step, the way he put it"), and lands
("Nobody from that fair is on the list of ten"). v1 archived to corpus/out-v1/
for the bake-off; front door shows only v2.

**Rejected:** tuning the constitution's wording (the constitution was not the
problem — its absence of verbatim material was); porting callcraft's 150-post
engagement library and scout stage now (one-pass with 27 references first;
selection-over-catalog is the recorded next step if the library grows).

---

## 2026-08-01 — The writer thinks in phases, and prose never travels inside JSON

**The founder's report, second round:** "it is about the quality writing and
everything" — better wasn't the bar; AIOS-session quality is the bar.

**Decision:** the writer now runs in the phases AIOS actually writes in:
FIND (read everything, name 0–3 tensions; JSON, because that output is data) →
WRITE (one call PER post, whole transcripts in context, output is the post
itself — no JSON anywhere near the prose) → CUT (the editor's pass: start
later, end earlier, add nothing). The judge stays downstream, drop-don't-revise.

**Why:** two register problems in the single-call design. A model asked to fill
a JSON string writes flatter than a model asked to write — escaping, no room to
breathe, the "data" register. And one call writing three posts gives each a
third of its attention. callcraft's founder named it: "AI needs to think in
phases." Cost triples (~308k input/week vs ~78k) and is worth exactly that:
subscription-flat, and quality is the product.

**The first live phased run found the next defect for us:** all three posts
died on the quote check. Prose register plus 27 quote-heavy reference posts
pulls the writer toward putting paraphrase in quote marks. Two-sided fix:
1. The quote law is now stated where the writing happens ("QUOTATION MARKS ARE
   A VERBATIM CLAIM… the reference posts' quotes were theirs to make; yours
   must be real") and again in the cut pass.
2. `dequoteUnmatched` — a paraphrase wearing quote marks loses its MARKS, not
   its post. Deterministic, surgical, zero word changes; the verbatim claim is
   withdrawn and the words stand as honest paraphrase. Executing a whole post
   for a stylistic quoting slip threw away three real posts in one run.

**Measured across three generations on the same ten calls:** v1 (constitution
only) — essay cadence, thesis-first. v2 (verbatim style + references) — scenes,
real speech, hard landings. v3 (phased) — denser operational detail, ownable
thesis lines ("Pain tells you what to build. It says nothing about who will
pay"), honest closes ("The HVAC job fails both, and I sold it anyway"). All
three generations archived under corpus/out-v* for the bake-off.

**Rejected:** letting the cut pass see the transcripts (doubles the cost of
every cut for marginal gain — the cut adds nothing by law, so it needs no
evidence); a model-driven quote-repair loop (revision loops are how callcraft
reached 328 drafts; the dequote is deterministic string surgery, not a rewrite).

---

## 2026-08-01 — "Like AIOS does" is a register, not a quality level

**The founder rejected two literary-register drafts.** Investigation found the
actual quality bar: the mac-cleanup post AIOS wrote for him
(AIOS_Phanindra/outputs/carousels/mac-cleanup-56gb/posts.md — the same post
callcraft used as its exemplar). Its register: result-first hook with numbers,
short standalone punch lines, arrow-bullet receipts, a "here's the part most
people miss" pivot, short declaratives, thesis landing ("This is what an AI
Operating System does").

**The constitution was banning his native register** — "listy asyndeton" and
short-fragment stacks are exactly what his best post is made of. Fixed:
- FOUNDER_EXEMPLAR embedded verbatim in the write phase, with what it teaches
  (structure and register only, never its facts).
- The ban narrowed to EMPTY fragment stacks; receipt-loaded punch lines are
  named as the author's native register.
- New law: MATCH THE SHAPE TO THE MATERIAL — receipts get the exemplar shape,
  lived stories get scene-first prose. Don't write a listy win as an essay or
  inflate a quiet story into a hype list.

**Lesson, appended to the distillation law:** the register IS content. A style
law that optimizes for tasteful prose can steer directly away from what the
author actually publishes. The exemplar beats the rules when they disagree.

---

## 2026-08-01 — Fathom-first provider readiness, not green-check theater

**Decision:** the write path syncs every provider entry but only reads from
providers whose transcript adapter is ready. Fathom is `readReady`; Gong and
Fireflies are explicitly `connect-only` with a reason shown in the UI and run
summary.

**Rejected — treating an ACTIVE connection as write-ready.** Connection proves
only that OAuth or Composio approval completed. Pretending it also proves that
TallTrack can list and read calls produces a silent empty week, which is harder
to diagnose than a visible limitation.

---

## 2026-08-01 — One shared editorial context, with a human outcome loop

**Decision:** the server writer and MCP `writing_guide` call the same exported
context builder: constitution, writing style, founder exemplar, templates,
derived audience/voice, and enough published examples for voice calibration.
Published, edited, and rejected outcomes are recorded beside the post; only the
first two feed future examples.

**Rejected — maintaining separate prompts.** A browser run and a Claude
conversation should not silently use different definitions of the founder's
voice. **Rejected — leaving feedback as a free-form note.** Three explicit
outcomes are measurable and keep the front door one click away from the taste
loop.

---

## 2026-08-01 — Stateless access-cookie gate for founder dogfood

**Decision:** when `TALLTRACK_ACCESS_TOKEN` is present, the browser must first
exchange it for a signed, HttpOnly, seven-day cookie. The cookie contains only a
fixed workspace id, expiry, nonce, and HMAC; MCP keeps its independent connector
key.

**Rejected — exposing the shared `solo` workspace publicly.** That would merge
calls and credentials for every visitor. **Rejected — building full multi-user
auth before proving the content loop.** The gate closes the immediate exposure
without committing TallTrack to an identity model that the founder has not yet
chosen.

---

## 2026-08-01 — Never replace an active notetaker during reconnect

**Decision:** `POST /api/notetakers/:provider/start` returns a clear conflict
when that provider is already ACTIVE. The person must disconnect first before a
new Composio account can replace it.

**Why:** the previous route wrote a new PENDING row after minting a link even
when a working account existed. A stale screen or repeated click could then
make a healthy connection look broken. A reconnect is an explicit destructive
change to the current provider identity and should not happen accidentally.

---

## 2026-08-01 — Import Callcraft's structure, not its creator posts

**Decision:** TallTrack now vendors Callcraft's compiled 24-entry LinkedIn
reference blueprint catalog. The FIND phase chooses one exact blueprint per
story; the WRITE phase receives that blueprint's hook, tension, beat map,
evidence role, rhythm, and ending as a locked structure. If FIND omits or
mistypes an id, TallTrack selects a deterministic fit-based fallback.

The artifact is structural only. Callcraft's raw CSV corpus remains outside
TallTrack and no source post body, creator name, URL, fact, offer, or
attribution enters the runtime prompt. This preserves the useful shape signal
without asking a founder's calls to imitate another creator's words.

**Rejected — pasting the entire Callcraft corpus into the prompt.** It would
inflate every paid run, increase copying and attribution risk, and make the
writer blend several references. **Rejected — maintaining a second MCP-only
prompt.** The catalog is part of `buildEditorialContext`, so browser and MCP
writing receive the same quality bar.

---

## 2026-08-01 — Five-post checks are evaluation mode, not the weekly default

**Decision:** the product keeps its normal three-draft ceiling. An explicit
`/api/week/write?candidates=4` or `?candidates=5` request can create a bounded
candidate set for a founder bake-off, and every candidate still goes through
the full cut and independent judge. The front door does not opt into this
higher-volume mode.

**Why:** comparing several Callcraft shapes is useful while calibrating the
writer, but routinely producing five paid drafts spends more, takes longer, and
encourages volume over the single strongest story.

---

## 2026-08-01 — AIOS-first writer replaces Callcraft's runtime editorial layer

**Decision:** TallTrack now writes the full call window in one user-engine call
using the AIOS LinkedIn, humanization, Content Writer, constitution, founder
exemplar, audience, and approved-post context. The response is tagged prose,
not JSON; the body stays outside a data contract. The separate quote check and
judge remain unchanged and still fail closed.

**Rejected — adding Callcraft's Jasmin, Matt, or larger template catalog.** Satya
does not like Callcraft's output; more of its structural DNA would enlarge the
wrong quality bar. **Rejected — keeping FIND → WRITE → CUT.** The extra stages
compress the material and normalize the prose. **Rejected — removing the judge
and grounding checks.** Human writing still must not contain invented quotes or
become a status update with no reader value.

**Why it matters:** TallTrack is now an AIOS-quality writing product with
Callcraft's reliable ingestion and safety plumbing, not a larger Callcraft.
Approved posts remain taste references only; transcript calls remain the sole
source of new facts.

---

## 2026-08-01 — Build the private bake-off from local first-party exports

**Decision:** prepare the ignored bake-off corpus from 10 Fathom-style call
exports in `Desktop/aios transcripts` and 10 posts authored by Satya in the
local `scraper/circle.db`. The preparation script records source ids and names
in a manifest but never prints or commits transcript/post bodies.

**Rejected:** using Callcraft's creator CSVs as the human baseline, because
those are third-party reference posts, not Satya's writing. **Rejected:**
calling the existing TallTrack v1/v2 outputs a Callcraft baseline, because they
were generated by TallTrack and are not comparable same-call outputs.

**Why it matters:** G2 can be run honestly against Satya's own posts now. G1
remains explicitly unscored until comparable Callcraft outputs for the same
calls are supplied; a missing baseline is better than a fabricated win.

---

## 2026-08-06 — The measured shape becomes law, from the 3,152-post creator corpus

**The founder's report, fourth round:** posts rejected as "not human like" —
and a direct instruction to build on the ~3,150-post ACX creator corpus
(Ruben Hassid 1,852, Michel Lieben 715, Jake Ward 585 posts with engagement
data) "at all levels."

**The measurement that reframed the problem.** Feature analysis of the top
300 posts by likes vs TallTrack's output: their hook is one line (median 44
chars) vs ours at 73–255; 91% of their lines are under 60 chars vs our
0–29%; they are 25–35 short lines with stacks, ours were 6 dense paragraphs.
Both prior register complaints ("not human", "not like AIOS") were really
the same physical-shape miss — the founder's own exemplar is in the corpus
shape.

**Decision, three levels:**
1. **Compiled shape library** — `scripts/compile-shape-library.ts` selects
   the top 8 posts per creator by likes (24 total, engagement-measured, not
   taste-guessed) into a generated module. Whole bodies travel as STRUCTURE
   references under an explicit lock: facts, names, offers, hooks, CTAs and
   phrases never transfer, and where a reference uses banned language the
   style law wins.
2. **SHAPE_LAW in the shared context** — the measured signature stated as
   law in `buildEditorialContext`, so the browser writer and MCP
   `writing_guide` carry it identically. The write prompt's "do not force a
   template/list" clause was replaced: the shape is the container.
3. **Deterministic shape check at the granular level** —
   `src/writer/shape-check.ts` (same philosophy as the quote check: string
   math, no model call). MCP `save_post` rejects essay-shaped bodies with
   the specific misses so Claude can reshape and retry. Thresholds sit
   looser than the medians (hook ≤80, ≥50% short lines, no block >220
   chars) so a lived story passes and a wall of prose does not.

**Partially reverses** the 2026-08-01 "AIOS-first" removal of Callcraft's
reference material, on the founder's explicit instruction — but keeps its
core finding: the abstract blueprints are still out; what returns is
verbatim high-engagement structure, selection-over-catalog, which is the
next step that decision itself recorded.

**Also fixed:** `/api/week` returned rejected posts to the front door; they
are now filtered in the query. Rejected drafts remain in the DB for the
taste loop.

---

## 2026-08-01 — Local demo seed instead of weakening Fathom readiness


**Decision:** add a local-only `/api/demo/seed` route and `npm run demo:seed`.
It is enabled only by the uncommitted `TALLTRACK_DEMO_MODE=1` local variable,
stores the same encrypted call shape as a real ingest, and shifts demo dates
inside the automatic seven-day window.

**Rejected:** making demo calls look like a successful Fathom sync, because
that would blur the difference between imported evidence and fixture material.
**Rejected:** exposing the route in production, because a transcript-import
endpoint is an unnecessary privacy and tenancy risk.

**Why it matters:** Satya can test Claude and the full writer/judge loop now,
without waiting for Fathom. The production path remains fail-closed and still
requires a real readable provider.

---

## 2026-08-01 — Use the installed Claude CLI for local bake-offs

**Decision:** add a local `bakeoff:claude` harness that streams the full prompt
through the installed Claude Code CLI, using Opus for writing and Sonnet for
the independent judge. TallTrack's writer, quote check, and judge remain the
code under test; the CLI supplies only authentication and model execution.

**Rejected:** copying a Claude API key into `.dev.vars`, because the user
already has an authenticated Claude subscription and the key would create a
second credential path to protect. **Rejected:** treating the Codex adapter as
browser-ready, because its account connection flow is not wired yet.

**Why it matters:** the CLI smoke check passed authentication, but the first
real bake-off was stopped by Claude's account spending cap until 3:30pm. The
harness now surfaces that exact provider message without writing a partial
result.

---

## 2026-08-06 — The MCP link is the product's front door: OAuth, one Approve, a fresh workspace

**Decision (Satya):** new people onboard by adding the bare MCP URL in
Claude. TallTrack now runs its own OAuth 2.1 server (the work the
2026-07-31 connector decision queued): RFC 9728 + 8414 discovery off the
401, RFC 7591 dynamic registration (public clients, PKCE S256 only), a
one-button consent page, and a token endpoint with refresh. Approving
creates a fresh `ws-…` workspace — no form, no email; the approval IS the
account.

**Mechanics worth recording:**
- Clients and codes live in KV with TTLs; tokens live in D1 as SHA-256
  hashes beside connector_keys. The code is deleted BEFORE the exchange —
  same replay rule as the Fireflies callback.
- `/mcp` accepts either credential: minted `tt_` keys (unchanged) or
  `ttat_` OAuth tokens.
- Each approval mints a NEW workspace; refresh tokens are how a session
  keeps its workspace. Re-adding the connector starts clean rather than
  guessing identity. Recorded limitation, acceptable for onboarding
  strangers; account linking is future work.
- `connect_notetaker`/`notetaker_status` tools close the loop in-chat:
  Composio hosted link out, exact-account status poll back, immediate sync
  on ACTIVE. Fireflies is web-only over MCP (its native OAuth needs our
  browser callback) and the tool says so instead of half-working.

**Rejected:** an unauthenticated `sign_up` tool returning a key (keys in
chat transcripts, no revocation story); requiring the web access gate first
(kills the one-link share). **Known consequence:** the consent page is a
public workspace mint. Rate limiting and workspace expiry for abandoned
empty workspaces are the first hardening steps if the link spreads wide.

---

## 2026-08-07 — Onboarding must survive every session type: /start beside OAuth

**The field report:** the first outside tester added the bare MCP URL from a
non-interactive Claude session — where the OAuth browser flow cannot run —
and stalled with unusable tools.

**Decision:** two onboarding paths, one per constraint. OAuth stays the
default for interactive sessions (add bare URL, /mcp, approve). For
everything else, /start is a public page whose one click mints a workspace
and returns the complete paste-ready `claude mcp add` command with the
connector key baked in. The MCP's 401 names both. The connector also now
carries its own onboarding: initialize instructions and an empty-week
this_week that offers connect_notetaker, so "added the link" flows into
"calls connected" without anyone reading docs.

**The trade, stated:** a key in a shell command lands in shell history.
Accepted for onboarding because the alternative was a hard stall; the key
is workspace-scoped, shown once, and replaceable. **Rejected:** trying to
detect non-interactive clients server-side (nothing on the wire
distinguishes them) and requiring OAuth for all (the stall this fixes).
Per-IP mint limit (20/day, KV) guards the public mint; same limit is the
first knob if abuse appears.

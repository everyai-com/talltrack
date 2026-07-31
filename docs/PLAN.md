# TallTrack — calls in, content worth publishing out

> **Written 2026-07-31.** A web sub-product of AIOS: connect your notetaker, log in with your own Claude or Codex, get a small number of posts you'd actually publish. Same shell, same auth, same runtime as AIOS web — only the screens this job needs.
>
> **Rubrics frozen at plan time** (per `rubrics/README.md`): `copy` (the output IS copy — this is the primary rubric), `design` + `child-test` (three new screens), `engineering` (the writer + ingestion). Every screen runs `design-principles-gate` and `outcome-first-critic` before merge. `/council` then `/grade` on each phase's built work.
>
> **One-line goal:** a founder connects Fathom and, without doing anything else, gets one to three posts a week they would be proud to publish — and an honest "nothing this week" when there isn't one.
>
> **Prior art consumed:** `~/Desktop/callcraft` (the same product, built and deployed, whose content is not good enough — the diagnosis in §0 is the reason this plan exists), `plans/2026-07-26-aios-web-byo.md` (W0–W5 shipped, this builds on it), `module-installs/editor-os/` (the judge, built 2026-07-31).

---

## 0. Why callcraft's content isn't good — the honest diagnosis

This is the whole plan. Everything else follows from getting this right, and getting it wrong again costs another two months.

Callcraft's content is not bad because its prompts are bad. Its prompts are careful, well-sourced, and heavily iterated. **The content is bad because of the architecture around them.** Five causes, in order of damage:

### 0.1 The writer never reads the call

The pipeline is eight stages, each handing the next a validated JSON summary: extract → moments → corpus window → story choice → template scout → creative director → writer → critic → reviser. By the time the writer writes, it is working from a compressed representation of a compressed representation. It has never seen the transcript.

That is the single biggest cause, and it explains most of the rest. Good writing comes from contact with the raw material — the thing someone said sideways at minute 34, the pause before the real objection, the two sentences that contradict each other. None of that survives extraction into a moment record with a salience score. **A summary is where writing goes to die.**

### 0.2 The claim ledger guarantees no fabrication and no prose

Every line of the body must cite moment IDs, with verbatim evidence spans, rebuilt after every edit. This works — fabrication rates are genuinely low.

It also forbids every sentence that isn't evidence: the aside, the authorial interpretation, the transition that gives the reader a breath, the line that exists because the paragraph before it earned one. What's left is defensible and dead. **The architecture optimizes for "can I prove this line" and good writing is mostly lines you can't prove.**

### 0.3 Ranking by salience picks the quotable, not the interesting

Story choice is a deterministic top-N over an opportunity score. The most concrete, most quotable thing in a delivery call is implementation minutiae — so that's what gets picked, every time, which is precisely what the stranger test was later bolted on to catch. Callcraft's own note calls this "the grounding law working too well." It isn't working too well; it's optimizing the wrong quantity. Salience is not story.

### 0.4 Volume is the enemy

**328 drafts. Zero published.** A system that always emits a pack will emit mediocrity on a quiet week, because it has no way to say there was nothing. And a founder who opens the app to five mediocre posts learns, correctly, that the app produces mediocre posts — and stops opening it. The 127-ready-none-published number is not a gate failure. It's what happens when quantity is the default.

### 0.5 Rubric-graded writing converges on the rubric's centroid

A seven-dimension critic scoring 1–10 produces posts that score well on seven dimensions. That is a description of competence, not of voice. Grading is necessary to catch failure; it cannot produce excellence, and using it as the optimization target makes everything land in the same well-behaved middle.

### The one-sentence version

> Callcraft compressed the material to save cost and context, then spent eighteen months trying to write well from the compression.

---

## 1. The thesis

> **One agent. The whole transcript in context. Taste in context. Writes in one pass. A separate judge that is allowed to say "nothing this week."**

That is how I write, and it is why the user asked for this. There is no pipeline. There is reading, then writing, then an honest second opinion.

**Why this is possible now and wasn't when callcraft was designed:** compression existed to save tokens and fit context. The user logs in with **their own Claude or Codex subscription** — `aios-core` already ships this (`src/providers/claude`, `src/providers/codex`). A frontier model on the user's own plan can hold three full transcripts and think about them. The constraint that forced the architecture that killed the writing is gone. Removing the constraint means removing the architecture, not tuning it.

**What this costs us:** the claim ledger goes, so fabrication is no longer structurally impossible. It becomes a checked property instead of a guaranteed one (§4, law 4 and the quote-check in §5.3). That is a real trade and it is the right one — callcraft proved that structurally-impossible fabrication also means structurally-impossible good writing.

---

## 2. Where it lives — its own repo, its own Cloudflare project

**Decision (Satya, 2026-07-31): TallTrack is standalone.** Its own folder, its own
git repo, its own Cloudflare project — not a surface inside `aios-core`.

The earlier draft of this plan recommended building inside `aios-core`, on the
grounds that it already ships the web client, BYO Claude/Codex login, auth, jobs,
runtime and the AIOS shell, so a new repo re-solves the four hardest problems.
That reasoning still stands on the merits and is recorded here rather than
quietly dropped. It was overridden for reasons that also stand:

- TallTrack is its own product with its own brand, pricing and billing.
- `aios-core` is mid-migration across a dozen worktrees; adding a second product
  surface to it now couples two things that both want to move fast.
- Callcraft proved a standalone Worker + D1 + R2 + KV carries this product
  comfortably. The plumbing is a known quantity, not a research project.

**What this costs, stated honestly:** auth, BYO-engine login, and the design
system get built here rather than inherited. Port the *patterns* from `aios-core`
(`src/providers/{claude,codex}`, `src/routes/providers.ts`) and from callcraft
rather than reinventing them, and keep the visual language identical to AIOS so
the two never diverge into different-looking products.

**Cloudflare resources** (account `a54b12fe…`, shared with AIOS and ~140 unrelated
projects, so everything is name-prefixed):

| Resource | Name | Binding |
|---|---|---|
| Worker | `talltrack` | — |
| D1 | `talltrack` | `DB` |
| R2 | `talltrack-transcripts` | `TRANSCRIPTS` |
| KV | `talltrack-sessions` | `SESSIONS` |

## 3. Ground truth to verify on day 1 (do not skip)

- **GT-1** — Read `callcraft/src/ingest/{fathom,fireflies,fireflies-mcp,composio-gong}.ts` in full. Both Fathom and Gong were API-verified in production. Port the *verified request shapes*, not the pipeline that consumes them. Note the endpoint-path gotcha recorded in callcraft's memory.
- **GT-2** — Read `callcraft/src/crypto/` and `src/privacy.ts`. Transcripts are envelope-encrypted in R2 with delete-means-delete. **That property is non-negotiable and carries over unchanged.** Confirm how `aios-core` does R2 + secrets before designing storage.
- **GT-3** — Port the BYO-engine flow from `aios-core/src/providers/{claude,codex}` and callcraft's engine-login. Confirm what a job actually gets — model access, context ceiling, streaming, and what happens when the user's subscription hits a limit mid-write. The whole thesis rests on being able to put full transcripts in context. **If the ceiling is too small, this plan changes shape; find out first.**
- **GT-4** — Read `aios-core/plans/cloud/11-contracts.md` (`JobEvent`, `AgentPrincipal`, failure/capability shapes). TallTrack does not have to implement them, but its job/event shapes should not gratuitously differ — a later merge or a shared runner gets much cheaper if they line up.
- **GT-5** — Confirm the per-run cost receipt path (`token-cost-receipt` skill). Long-context writing is the most expensive thing AIOS will do per run. It must show its cost.
- **GT-6** — Pull 10 real transcripts from Satya's Fathom and 10 posts he actually published. **These are the bake-off corpus (§7). Nothing else starts until they exist.**

---

## 4. The editorial constitution

Seven laws. They live in one file, they are the writer's system prompt, and they are what "insanely good" means operationally. Every one is falsifiable.

1. **Read everything.** The writer receives full transcripts. No summary, no extraction, no moment record ever sits between the source and the writer. If the material doesn't fit, use fewer calls — never a compression of more.
2. **One tension per post.** Find the single real tension — before/after, expected/actual, everyone-believes-X-here's-why-not. **No tension, no post.** Say so and stop. Never manufacture one.
3. **An opinion, not a synthesis.** The post takes a position someone could disagree with. A balanced summary of what was said is not a post.
4. **Every specific is real; every specific is relevant.** Numbers, names, quotes come from the transcript, verbatim or not at all. *And* they pass the stranger test — a reader who wasn't on the call carries something away. Real-but-irrelevant is the failure that produced 127 unpublished posts.
5. **Earned length.** Cut to the bone, then cut once more. If the material can't carry a whole post, the material is the answer — not padding.
6. **Human rhythm.** Vary sentence length. No em-dash drama, no rule-of-three padding, no "it's not X, it's Y", no listy asyndeton, no hollow uplift. (Port `callcraft/prompts/style.ts` verbatim — that file is good and was never the problem.)
7. **Kill freely.** Producing nothing is a valid, correct, good output. **A quiet week gets "nothing worth posting, here's why" and that ships as a feature**, on the front door, in those words.

---

## 5. Architecture — three moves, not eight stages

### 5.1 Ingest (port, don't rebuild)
Notetaker webhook/poll → transcript → envelope-encrypt → R2 → row in D1. That's it. **No extraction, no moments, no salience, no corpus window.** The transcript is the unit; it is stored whole and read whole.

### 5.2 Write (one agent, one pass)
A job on the user's own engine. In context: the full transcripts for the window, `context/writing-taste.md` (from `editor-os`, if they have one), their published posts, who they sell to, and the constitution. Out: **zero to three posts**, each with its own reasoning about why this tension and not another.

One agent. One pass. It may think as long as it wants. It may return nothing.

### 5.3 Judge (separate, and can veto)
`editor-os`'s `check-post`, run server-side by a *different* call than the one that wrote — the maker must not be the judge. Three checks:
- **The stranger test** (floor 6). Callcraft's single best asset. It carries over intact.
- **Quote check.** Every quoted span must appear in the transcript. A quote that doesn't match is a hard fail — the post is dropped, not revised. This replaces the claim ledger: cheap, targeted at the one thing that must never happen, and it doesn't touch prose that isn't a quote.
- **The craft read**, as bands not decimals (see §8) — a veto on the weak, never the optimization target.

Anything that fails is **dropped, not revised**. Revision loops are how callcraft got 328 drafts. If a post isn't good, there wasn't a post there.

---

## 6. Product shape — three screens

Per `outcome-first-critic`: the front door is the outcome, never a chat box, never a menu.

1. **Connect** — log in with Claude or Codex (exists), connect Fathom/Gong/Fireflies (new). Two steps, nothing else.
2. **This week** — the front door. One to three posts, or the honest zero stated plainly: *"Nothing worth posting from this week's four calls — they were all scheduling and status. Here's what would have made one."*
3. **The post** — read it, copy it, edit it, say what you did with it. The "what you did" is the taste loop, and per the `editor-os` verdict it will starve unless it's one tap on the screen where the post already is. **It is not a chat message.**

No dashboard. No calendar. No library screen until someone asks for one twice.

---

## 7. The bake-off — built first, before any product code

Callcraft's quality failure was invisible for weeks because nothing measured it. So the measurement gets built before the thing it measures.

**The harness:** the 10 real transcripts and 10 published posts from GT-6. For each transcript, collect (a) what callcraft produced, (b) what the new writer produces, (c) what Satya actually published. Strip all provenance. Present blind, in random order.

**Three gates, in order:**

- **G1 — beats callcraft.** New writer wins ≥7 of 10 blind pairwise against callcraft's output on the same calls. *If this fails, the thesis in §1 is wrong and we stop and rethink rather than tune.*
- **G2 — near the human bar.** Satya cannot reliably tell his own published posts from the writer's. Scored as: he picks his own at ≤65% across 20 blind pairs. This is the actual "insanely good like you" test, and it is the honest one.
- **G3 — honest zero works.** Fed four transcripts with no story in them, the writer returns nothing, with a reason, and doesn't invent a post. Run on deliberately dull calls.

**G1 is the kill gate.** It runs at the end of S2, before any screen exists. Failing it costs two weeks, not two months.

---

## 8. Phases

| # | Phase | Done when |
|---|---|---|
| **S0** | Ground truth + bake-off harness. GT-1…GT-6. Corpus assembled, blind-presentation harness works. | The 20 artifacts exist and can be presented blind. **No product code yet.** |
| **S1** | Ingestion into `aios-core`. Fathom first (Gong, Fireflies after). Envelope-encrypted R2, delete-means-delete, no transcript text in logs. | A real call lands encrypted and readable; `/security-review` clean. |
| **S2** | The writer. Constitution + one-pass job on the user's engine. **No screens.** | **G1 passes.** Cost receipt per run visible. |
| **S3** | The judge. Stranger test + quote check + craft bands, drop-don't-revise. | G3 passes; no post with an unmatched quote survives 50 runs. |
| **S4** | The three screens, in the AIOS shell. | `design-principles-gate` + `outcome-first-critic` + `/council copy` + `/grade` all pass. Live visual smoke both themes. |
| **S5** | Taste loop — one tap on the post screen, feeding `context/writing-taste.md`. | ≥10 verdicts recorded from real use, and a stated preference visibly changes output. |
| **Gate** | **G2**, then 10 external users through the whole loop. | Ship. |

**Fix carried over from the `editor-os` grade:** craft scores are **bands** (*generic / solid / ready / rare*), not decimals. Callcraft's 7.25 and 8.0 were fit against a measured corpus; a model eyeballing a draft and emitting "8.1" is false precision. Thresholds survive as rules over bands ("hook and voice must both be *ready*"). Same discipline, no fake decimal.

---

## 9. What we take from callcraft, and what we delete

**Take:** notetaker ingestion (API-verified), envelope encryption + privacy posture, the BYO-engine pattern, `prompts/style.ts` (anti-slop, verbatim), `prompts/reach.ts` (the stranger test — the best thing in the repo), the reference-blueprint compiler as an optional later import, and every hard-won lesson in `docs/DECISIONS.md`.

**Delete, deliberately:** the eight-stage pipeline, moment extraction, salience ranking, the corpus window, template scout / creative director staging, the claim ledger, `format_meta`, the revision writer, and per-pack volume. These are not unfinished — they are finished, and they are the cause.

**Not a criticism of the work.** Callcraft's constraints were correct for the cost and context ceiling it was designed against. This plan is only possible because BYO-engine removed that ceiling, and only *knowable* because callcraft ran long enough in production to produce the numbers in §0.

---

## 10. Risks and kill criteria

| Risk | Mitigation / kill |
|---|---|
| **Context ceiling too small for full transcripts** | GT-3, day one. If a user's engine can't hold two full calls, the thesis needs reshaping before S1 — not after. |
| **G1 fails — one-pass isn't better** | Stop. Do not tune. §0 was wrong and the next move is a different diagnosis, not a better prompt. |
| **Fabrication rises without the claim ledger** | Quote check (§5.3) + drop-don't-revise. Measure fabrication rate across the bake-off corpus explicitly at S3; if it exceeds callcraft's, the ledger's replacement is insufficient and we reconsider. |
| **Taste loop starves (the `editor-os` finding)** | One tap on the post screen, never a chat message. If ≥10 verdicts don't land by S5, cut the loop rather than shipping a dead mechanism. |
| **Long-context writing is expensive** | It runs on the user's own subscription — that's the point — but the per-run receipt (GT-5) is mandatory, not optional. |
| **Wedge conflict** | Sales-content is the ACTIVE wedge (`sales-content-wedge-pivot`, 2026-07-18, cofounder Suprava). This is squarely it. But three ICP theses are alive at once (`wealth-offices-wedge-fork`) — this plan assumes sales-content and says so. |

---

## 11. The single most important thing in this document

**Do not start with screens.** Callcraft has screens, deployment, auth, ingestion, a taste-learning loop, and a Taste Test UI — all built, all working — and its content isn't good enough, so none of it matters. The product is the writing. S0 through S3 build and measure the writing with no screens at all, and G1 either proves the thesis in two weeks or kills it.

/**
 * The bake-off harness (docs/PLAN.md §7).
 *
 * Built before the product because callcraft's quality failure was invisible
 * for weeks for exactly the want of it. G1 — beat callcraft on 7 of 10 blind —
 * is a kill gate, and a kill gate you cannot run is not a gate.
 *
 *   corpus/transcripts/*.txt   real calls, one per file        (gitignored)
 *   corpus/published/*.md      posts the founder really posted (gitignored)
 *   corpus/callcraft/*.md      what callcraft produced, same calls, optional
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node --experimental-strip-types scripts/bakeoff.ts generate
 *   node --experimental-strip-types scripts/bakeoff.ts pairs published
 *   node --experimental-strip-types scripts/bakeoff.ts score published
 *   node --experimental-strip-types scripts/bakeoff.ts pairs callcraft
 *
 * Nothing here writes to Cloudflare. The corpus is real call material and never
 * leaves the machine.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { produce } from '../src/writer/index.ts'
import type { CallInput } from '../src/writer/write.ts'

const CORPUS = 'corpus'
const OUT = join(CORPUS, 'out')

function read(dir: string): Array<{ name: string; text: string }> {
  const path = join(CORPUS, dir)
  if (!existsSync(path)) return []
  return readdirSync(path)
    .filter((f) => !f.startsWith('.'))
    .sort()
    .map((f) => ({ name: basename(f).replace(/\.(txt|md)$/, ''), text: readFileSync(join(path, f), 'utf8') }))
}

/**
 * Deterministic shuffle. A blind comparison has to be reproducible or a
 * disagreement about the result becomes an argument about which shuffle ran.
 */
function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items]
  let state = seed
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0
    const j = state % (i + 1)
    const a = out[i]!
    const b = out[j]!
    out[i] = b
    out[j] = a
  }
  return out
}

async function generate() {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    console.error('Set ANTHROPIC_API_KEY. The bake-off runs on a real engine — that is the point.')
    process.exit(1)
  }

  const transcripts = read('transcripts')
  if (transcripts.length === 0) {
    console.error(`No transcripts in ${join(CORPUS, 'transcripts')}. GT-6 first: 10 real calls.`)
    process.exit(1)
  }

  const published = read('published').map((p) => p.text)
  mkdirSync(OUT, { recursive: true })

  let posts = 0
  let quiet = 0

  for (const t of transcripts) {
    const calls: CallInput[] = [
      { id: t.name, title: t.name, occurredAt: new Date(0).toISOString(), transcript: t.text },
    ]

    const result = await produce({ engine: 'claude', secret: key }, calls, { publishedExamples: published })

    if (result.kept.length === 0) {
      quiet++
      console.log(`  ${t.name}: nothing — ${result.nothingBecause}`)
      writeFileSync(join(OUT, `${t.name}.nothing.txt`), result.nothingBecause ?? '')
      continue
    }

    result.kept.forEach((k, i) => {
      posts++
      writeFileSync(join(OUT, `${t.name}.${i}.md`), k.draft.body)
      console.log(`  ${t.name}: kept (reach ${k.verdict.reach}) — ${k.draft.tension}`)
    })
    result.dropped.forEach((d) => console.log(`  ${t.name}: dropped — ${d.verdict.droppedBecause}`))
  }

  console.log(`\n${posts} posts from ${transcripts.length} calls. ${quiet} produced nothing.`)
  console.log('A quiet rate near zero is a red flag, not a success — see docs/PLAN.md §0.4.')
}

/**
 * Blind pairs. Provenance is stripped and side assignment is by seed, so the
 * person scoring cannot tell which side is ours — including when that person
 * is the one who built it.
 */
type ComparisonTarget = 'published' | 'callcraft'

function comparisonTarget(): ComparisonTarget {
  const target = process.argv[3] ?? 'published'
  if (target !== 'published' && target !== 'callcraft') {
    console.error('Comparison target must be published or callcraft.')
    process.exit(1)
  }
  return target
}

function pairs() {
  const target = comparisonTarget()
  const ours = read('out').filter((f) => !f.name.endsWith('.nothing'))
  const theirs = read(target)

  if (ours.length === 0 || theirs.length === 0) {
    console.error(`Need generated posts and ${target} comparison posts.`)
    process.exit(1)
  }

  const pairCount = target === 'callcraft' ? Math.min(10, ours.length) : 20
  const oursPool = target === 'published' ? [...ours, ...ours] : ours
  const theirsPool = [...theirs, ...theirs]

  const lines: string[] = [
    `# Blind pairs — ${target}`,
    '',
    `For each pair, write A or B in the verdict column of corpus/scores-${target}.csv.`,
    'Do not look at corpus/out/ first. Which one would you actually publish?',
    '',
  ]

  const rows: string[] = ['pair,left,right,verdict']

  shuffle(oursPool, 7)
    .slice(0, pairCount)
    .forEach((mine, i) => {
      const other = shuffle(theirsPool, 11 + i)[i % theirsPool.length]!
      const mineLeft = (i + Number(mine.name.length)) % 2 === 0
      const [left, right] = mineLeft ? [mine, other] : [other, mine]

      lines.push(`## Pair ${i + 1}`, '', '**A**', '', left.text.trim(), '', '---', '', '**B**', '', right.text.trim(), '', '---', '')
      rows.push(`${i + 1},${mineLeft ? 'ours' : 'other'},${mineLeft ? 'other' : 'ours'},`)
    })

  writeFileSync(join(CORPUS, `pairs-${target}.md`), lines.join('\n'))
  writeFileSync(join(CORPUS, `scores-${target}.csv`), rows.join('\n') + '\n')
  console.log(`Wrote pairs-${target}.md and scores-${target}.csv. Fill in verdicts, then run: score ${target}`)
}

function score() {
  const target = comparisonTarget()
  const path = join(CORPUS, `scores-${target}.csv`)
  if (!existsSync(path)) {
    console.error(`Missing ${path}. Run: pairs ${target}`)
    process.exit(1)
  }
  const csv = readFileSync(path, 'utf8').trim().split('\n').slice(1)
  let ours = 0
  let judged = 0

  for (const row of csv) {
    const [, left, right, verdict] = row.split(',')
    const pick = verdict?.trim().toUpperCase()
    if (pick !== 'A' && pick !== 'B') continue
    judged++
    if ((pick === 'A' ? left : right)?.trim() === 'ours') ours++
  }

  if (judged === 0) {
    console.error('No verdicts filled in yet.')
    process.exit(1)
  }

  const rate = ours / judged
  console.log(`\nTallTrack won ${ours} of ${judged} ${target} comparisons (${Math.round(rate * 100)}%)`)
  if (target === 'callcraft') {
    console.log(
      rate >= 0.7
        ? 'G1 PASSES. The thesis holds — carry on to S3.'
        : 'G1 FAILS. Stop. Do not tune the prompt; §0 was wrong and needs a different diagnosis.',
    )
  } else {
    console.log('This is the founder-bar comparison. It is not a G1 Callcraft score.')
  }
}

const cmd = process.argv[2]
if (cmd === 'generate') await generate()
else if (cmd === 'pairs') pairs()
else if (cmd === 'score') score()
else {
  console.log('Usage: bakeoff.ts generate | pairs published|callcraft | score published|callcraft')
  process.exit(1)
}

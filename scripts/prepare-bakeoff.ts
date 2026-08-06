/**
 * Assemble the private bake-off corpus from local exports.
 *
 * Sources are deliberately outside this repository:
 *   - Satya's own posts in scraper/circle.db
 *   - Fathom-style call exports in Desktop/aios transcripts
 *
 * The resulting corpus/ directory is gitignored. This script writes only a
 * small manifest to stdout; transcript and post bodies never enter logs.
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const CORPUS = join(ROOT, 'corpus')
const TRANSCRIPT_ROOT = process.env.BAKEOFF_TRANSCRIPT_ROOT
  ?? '/Users/satyaphanindra/Desktop/aios transcripts'
const CIRCLE_DB = process.env.BAKEOFF_CIRCLE_DB
  ?? '/Users/satyaphanindra/Desktop/scraper/circle.db'

// These are real call exports, chosen to cover the workshop, Q&A, audit, and
// partner-conversation material already used by TallTrack's local fixtures.
const TRANSCRIPTS = [
  'AIOS042126transcript.vtt',
  'AIOS042326transcript.vtt',
  'AIOS042826transcript.vtt',
  'AIOS042926transcript.vtt',
  'AIOS050126transcript.vtt',
  'AIOS050426transcript.vtt',
  'AIOS051326transcript.vtt',
  'AIOS051426transcript.vtt',
  'AIOSauditsalesprocesstranscript.vtt',
  'bsnQNAwerik051926.vtt',
] as const

// Long, substantive posts authored by Satya. The selection is deterministic
// and intentionally excludes creator/reference posts from Callcraft's CSVs.
const PUBLISHED_POST_IDS = [
  33321101,
  30249186,
  19800905,
  27679390,
  19802024,
  18672229,
  21601359,
  31834627,
  30125799,
  30755450,
] as const

type PostRow = { id: number; title: string; body_text: string }

function readOwnPosts(): PostRow[] {
  if (!existsSync(CIRCLE_DB)) throw new Error(`Missing local post database: ${CIRCLE_DB}`)
  const ids = PUBLISHED_POST_IDS.join(',')
  const sql = [
    'SELECT id, title, body_text',
    'FROM posts',
    `WHERE author_member_id = 22630882 AND id IN (${ids})`,
    'ORDER BY published_at DESC',
  ].join(' ')
  const output = execFileSync('sqlite3', ['-json', CIRCLE_DB, sql], { encoding: 'utf8' })
  const rows = JSON.parse(output) as PostRow[]
  if (rows.length !== PUBLISHED_POST_IDS.length) {
    throw new Error(`Expected ${PUBLISHED_POST_IDS.length} Satya posts, found ${rows.length}`)
  }
  if (rows.some((row) => !row.body_text?.trim())) throw new Error('A selected published post has no body')
  return rows
}

function plainTextFromVtt(vtt: string): string {
  return vtt
    .replace(/^WEBVTT\s*/iu, '')
    .split(/\r?\n/u)
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed || /^\d+$/.test(trimmed)) return false
      if (/^NOTE(?:\s|$)/iu.test(trimmed)) return false
      if (/^\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+-->\s+\d{2}:\d{2}:\d{2}/u.test(trimmed)) return false
      return true
    })
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function prepare(): void {
  if (!existsSync(TRANSCRIPT_ROOT)) throw new Error(`Missing transcript folder: ${TRANSCRIPT_ROOT}`)
  const missing = TRANSCRIPTS.filter((name) => !existsSync(join(TRANSCRIPT_ROOT, name)))
  if (missing.length > 0) throw new Error(`Missing transcript exports: ${missing.join(', ')}`)

  const published = readOwnPosts()
  const transcriptDir = join(CORPUS, 'transcripts')
  const publishedDir = join(CORPUS, 'published')
  // Corpus contents are derived and ignored. Rebuilding avoids stale examples
  // silently entering a future run after a local export changes.
  rmSync(transcriptDir, { recursive: true, force: true })
  rmSync(publishedDir, { recursive: true, force: true })
  mkdirSync(transcriptDir, { recursive: true })
  mkdirSync(publishedDir, { recursive: true })

  const transcriptManifest = TRANSCRIPTS.map((name, index) => {
    const text = plainTextFromVtt(readFile(join(TRANSCRIPT_ROOT, name)))
    if (text.length < 200) throw new Error(`Transcript is unexpectedly short: ${name}`)
    const file = `${String(index + 1).padStart(2, '0')}-${name.replace(/\.vtt$/iu, '')}.txt`
    writeFileSync(join(transcriptDir, file), text + '\n')
    return { file, source: name, chars: text.length }
  })

  const publishedManifest = published.map((post, index) => {
    const file = `${String(index + 1).padStart(2, '0')}-${post.id}.md`
    writeFileSync(join(publishedDir, file), post.body_text.trim() + '\n')
    return { file, sourceId: post.id, title: post.title, chars: post.body_text.trim().length }
  })

  writeFileSync(join(CORPUS, 'manifest.json'), JSON.stringify({
    preparedAt: new Date().toISOString(),
    transcripts: transcriptManifest,
    published: publishedManifest,
    callcraftBaseline: 'missing — do not claim G1 until same-call Callcraft outputs are supplied',
  }, null, 2) + '\n')

  console.log(`Prepared private corpus: ${transcriptManifest.length} transcripts, ${publishedManifest.length} Satya posts.`)
  console.log('Callcraft baseline: missing; G1 remains unscored.')
}

function readFile(path: string): string {
  return readFileSync(path, 'utf8')
}

prepare()

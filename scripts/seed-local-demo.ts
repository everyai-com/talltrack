/** Seed the running local Worker with the private bake-off transcripts. */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const baseUrl = process.env.TALLTRACK_LOCAL_URL ?? 'http://127.0.0.1:8787'
const dir = join(process.cwd(), 'corpus', 'transcripts')
const files = readdirSync(dir).filter((file) => file.endsWith('.txt')).sort().slice(0, 12)

if (files.length === 0) throw new Error('Prepare the corpus first: npm run bakeoff:prepare')

const now = Date.now()
const calls = files.map((file, index) => ({
  id: `demo-${file.replace(/\.txt$/u, '')}`,
  title: `Demo call ${index + 1} — ${file.replace(/\.txt$/u, '')}`,
  // Keep the private demo calls inside the automatic seven-day window.
  occurredAt: new Date(now - index * 60 * 60 * 1000).toISOString(),
  transcript: readFileSync(join(dir, file), 'utf8'),
}))

const response = await fetch(`${baseUrl}/api/demo/seed`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ calls }),
})
const result = await response.json() as { seeded?: number; error?: string }
if (!response.ok) throw new Error(result.error ?? `Seed failed (${response.status})`)
console.log(`Seeded ${result.seeded ?? 0} private demo calls into ${baseUrl}.`)

/**
 * Run TallTrack's private bake-off through the installed Claude Code CLI.
 *
 * This is intentionally a local harness, not a production engine adapter:
 * Claude Code owns authentication and billing, while TallTrack still owns the
 * writer, quote check, judge, and output contract.
 *
 * Usage:
 *   npm run bakeoff:claude -- 1   # one-call smoke test
 *   npm run bakeoff:claude -- 10  # full private corpus
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { produce } from '../src/writer/index.ts'
import type { Engine, RunRequest, RunResult } from '../src/engine/types.ts'
import type { CallInput } from '../src/writer/write.ts'

const CORPUS = join(process.cwd(), 'corpus')
const OUT = join(CORPUS, 'out-cli')
const requested = Number(process.argv[2] ?? '10')
const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 10) : 10

function read(dir: string): Array<{ name: string; text: string }> {
  const path = join(CORPUS, dir)
  if (!existsSync(path)) return []
  return readdirSync(path)
    .filter((file) => !file.startsWith('.'))
    .sort()
    .map((file) => ({ name: basename(file).replace(/\.(txt|md)$/u, ''), text: readFileSync(join(path, file), 'utf8') }))
}

type CliResult = {
  type?: string
  subtype?: string
  is_error?: boolean
  result?: string
  model?: string
  usage?: { input_tokens?: number; output_tokens?: number }
  modelUsage?: Record<string, { inputTokens?: number; outputTokens?: number }>
}

function runCli(model: 'opus' | 'sonnet', prompt: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [
      '-p',
      '--output-format', 'json',
      '--model', model,
      '--setting-sources', 'user',
      '--permission-mode', 'plan',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('Claude CLI timed out'))
    }, 5 * 60 * 1000)

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      let parsed: CliResult | null = null
      try {
        parsed = JSON.parse(stdout.trim()) as CliResult
      } catch {
        reject(new Error(`Claude CLI failed (${code ?? 'unknown'}): ${stderr.slice(-300) || 'no response'}`))
        return
      }

      try {
        if (parsed.is_error || !parsed.result?.trim()) throw new Error(parsed.result ?? 'Claude returned no text')
        const usage = parsed.usage ?? {}
        const modelUsage = parsed.modelUsage ?? {}
        const actualModel = Object.keys(modelUsage)[0] ?? parsed.model ?? model
        resolve({
          text: parsed.result.trim(),
          model: actualModel,
          inputTokens: usage.input_tokens ?? modelUsage[actualModel]?.inputTokens ?? 0,
          outputTokens: usage.output_tokens ?? modelUsage[actualModel]?.outputTokens ?? 0,
        })
      } catch (error) {
        reject(new Error(`Could not read Claude CLI response: ${error instanceof Error ? error.message : String(error)}`))
      }
    })

    // Keep the system prompt and full transcript out of argv and shell logs.
    child.stdin.end(prompt)
  })
}

function cliEngine(model: 'opus' | 'sonnet'): Engine {
  return {
    name: 'claude',
    run(req: RunRequest) {
      return runCli(model, `${req.system}\n\nHere is the user material:\n\n${req.user}`)
    },
  }
}

async function main(): Promise<void> {
  const transcripts = read('transcripts').slice(0, limit)
  const published = read('published').map((post) => post.text)
  if (transcripts.length < limit) throw new Error(`Need ${limit} prepared transcripts; found ${transcripts.length}`)
  if (published.length < 3) throw new Error('Need at least 3 prepared published posts')
  mkdirSync(OUT, { recursive: true })

  const writer = cliEngine('opus')
  const jury = cliEngine('sonnet')
  const receipts: Array<Record<string, unknown>> = []

  for (const transcript of transcripts) {
    const call: CallInput = {
      id: `demo-${transcript.name}`,
      title: transcript.name,
      occurredAt: new Date(0).toISOString(),
      transcript: transcript.text,
    }
    const result = await produce(
      { engine: 'claude', secret: 'claude-cli' },
      [call],
      { publishedExamples: published },
      { writer, jury },
    )

    const base = transcript.name
    if (result.kept.length === 0) {
      writeFileSync(join(OUT, `${base}.nothing.txt`), result.nothingBecause ?? '')
      console.log(`${base}: nothing — ${result.nothingBecause ?? 'no surviving draft'}`)
    } else {
      result.kept.forEach((kept, index) => {
        writeFileSync(join(OUT, `${base}.${index}.md`), kept.draft.body)
        console.log(`${base}: kept — ${kept.draft.tension}`)
      })
      result.dropped.forEach((dropped) => console.log(`${base}: dropped — ${dropped.verdict.droppedBecause}`))
    }

    receipts.push({
      transcript: base,
      kept: result.kept.length,
      dropped: result.dropped.length,
      nothingBecause: result.nothingBecause ?? null,
      receipt: result.receipt,
    })
  }

  writeFileSync(join(CORPUS, 'receipts-cli.json'), JSON.stringify({ limit, receipts }, null, 2) + '\n')
  console.log(`\nCompleted ${transcripts.length} Claude CLI bake-off calls. Bodies are under corpus/out-cli/.`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

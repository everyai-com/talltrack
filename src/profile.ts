import type { Engine } from './engine'
import { extractJson } from './writer/write'
import type { CallInput } from './writer/write'

/**
 * Who this person is, learned from their own calls.
 *
 * Derived once from real transcripts, then handed to the writer as context and
 * to the judge as "who the stranger is". This is what "connecting Fathom means
 * it understands you" actually is — not a form they fill in, but their own
 * calls read closely.
 *
 * Derivation runs on the cheaper judge-tier model: it is extraction, not
 * writing, and it spends the user's subscription.
 */

export type Profile = {
  /** Who they are and what they sell, in two sentences. */
  who: string
  /** The specific reader they should be writing for. */
  audience: string
  /** How they actually talk — phrases, energy, formality. From their speech only. */
  voice: string
  derivedFromCalls: number
  derivedAt: string
}

export type ProfileEnv = Pick<Cloudflare.Env, 'DB'>

const DERIVE_SYSTEM = `You are reading sales-call transcripts to learn who the
SELLER is — the person whose workspace this is. Read every transcript fully,
then return ONLY JSON, no prose and no code fence:

{
  "who": "who they are and what they sell — two sentences, from evidence in the calls",
  "audience": "the specific person they sell to: role, company shape, what that person is dealing with. Not 'businesses' — the actual buyer you can hear on these calls",
  "voice": "how the seller actually talks: pace, formality, characteristic phrases, how they explain things. Quote a short phrase or two of theirs"
}

Rules:
- Everything must be earned by the transcripts. If the calls don't show it,
  write what you can support and no more. Never pad with plausible guesses.
- The seller is usually the one demoing, quoting prices, or answering "how does
  it work". Identify them by behaviour, not by name order.
- "voice" describes only the seller's own speech, never the customers'.`

export function buildDerivePrompt(calls: CallInput[]): string {
  return `Transcripts follow. The seller is the same person across all of them.\n\n${calls
    .map((c) => `<call title="${c.title.replace(/"/g, "'")}" date="${c.occurredAt}">\n${c.transcript}\n</call>`)
    .join('\n\n')}`
}

export function parseProfile(text: string, callCount: number): Profile {
  const raw = extractJson(text) as { who?: unknown; audience?: unknown; voice?: unknown }
  const field = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const who = field(raw.who)
  const audience = field(raw.audience)
  if (!who || !audience) throw new Error('profile_incomplete')
  return {
    who,
    audience,
    voice: field(raw.voice),
    derivedFromCalls: callCount,
    derivedAt: new Date().toISOString(),
  }
}

export async function deriveProfile(engine: Engine, calls: CallInput[]): Promise<Profile> {
  const res = await engine.run({
    system: DERIVE_SYSTEM,
    user: buildDerivePrompt(calls),
    maxOutputTokens: 1000,
    temperature: 0,
  })
  return parseProfile(res.text, calls.length)
}

export async function saveProfile(env: ProfileEnv, workspaceId: string, profile: Profile): Promise<void> {
  await env.DB.prepare(
    `insert into profiles (workspace_id, who, audience, voice, derived_from_calls, derived_at)
     values (?1, ?2, ?3, ?4, ?5, ?6)
     on conflict (workspace_id) do update set who = excluded.who, audience = excluded.audience,
       voice = excluded.voice, derived_from_calls = excluded.derived_from_calls, derived_at = excluded.derived_at`,
  )
    .bind(workspaceId, profile.who, profile.audience, profile.voice, profile.derivedFromCalls, profile.derivedAt)
    .run()
}

export async function loadProfile(env: ProfileEnv, workspaceId: string): Promise<Profile | null> {
  const row = await env.DB.prepare(`select * from profiles where workspace_id = ?1`)
    .bind(workspaceId)
    .first<{ who: string; audience: string; voice: string; derived_from_calls: number; derived_at: string }>()
  if (!row) return null
  return {
    who: row.who,
    audience: row.audience,
    voice: row.voice,
    derivedFromCalls: row.derived_from_calls,
    derivedAt: row.derived_at,
  }
}

/** The audience string the writer and judge receive. One place, so they always agree. */
export function audienceContext(profile: Profile): string {
  return `${profile.who}\n\nThey are writing for: ${profile.audience}${
    profile.voice ? `\n\nHow they sound: ${profile.voice}` : ''
  }`
}

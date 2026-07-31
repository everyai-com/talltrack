import type { CallMeta, Connector, TranscriptResult } from './types'

/**
 * Fathom (developers.fathom.ai). API-key auth, cursor-paged.
 *
 * Request shapes ported from callcraft's src/ingest/fathom.ts, which was
 * verified against the live API in production. The response-shape tolerance
 * below (items vs meetings, recording_id vs id) is not defensiveness for its
 * own sake — it is what the real API actually returned across endpoints.
 */

const BASE = 'https://api.fathom.ai/external/v1'

function headers(creds: Record<string, string>): Record<string, string> {
  return { 'X-Api-Key': creds.apiKey ?? '', accept: 'application/json' }
}

export type FathomMeeting = {
  id?: string | number
  recording_id?: string | number
  title?: string | null
  meeting_title?: string | null
  created_at?: string
  scheduled_start_time?: string
  recording_start_time?: string
  recording_end_time?: string
  url?: string
  share_url?: string
}

export type FathomSegment = {
  speaker?: string | { name?: string | null } | null
  text?: string | null
  words?: string | null
}

export function toMeta(m: FathomMeeting): CallMeta {
  const start = m.recording_start_time ?? m.scheduled_start_time ?? m.created_at ?? new Date().toISOString()
  const end = m.recording_end_time
  const durationS = end ? Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000)) : 0
  return {
    externalId: String(m.recording_id ?? m.id ?? ''),
    title: m.meeting_title ?? m.title ?? 'Untitled call',
    occurredAt: new Date(start).toISOString(),
    durationS,
    providerUrl: m.share_url ?? m.url ?? null,
  }
}

function speakerName(speaker: FathomSegment['speaker']): string {
  if (typeof speaker === 'string') return speaker
  if (speaker && typeof speaker === 'object' && typeof speaker.name === 'string') return speaker.name
  return 'Speaker'
}

/**
 * Speaker-labelled plain text, with consecutive turns by the same person
 * merged. The writer reads this whole — timestamps and per-line speaker tags
 * every few words are noise that costs context and buys nothing.
 */
export function segmentsToText(segments: FathomSegment[]): string {
  const turns: Array<{ speaker: string; text: string }> = []

  for (const seg of segments) {
    const text = (seg.text ?? seg.words ?? '').trim()
    if (!text) continue
    const speaker = speakerName(seg.speaker)
    const last = turns[turns.length - 1]
    if (last && last.speaker === speaker) last.text += ` ${text}`
    else turns.push({ speaker, text })
  }

  return turns.map((t) => `${t.speaker}: ${t.text}`).join('\n')
}

async function get(creds: Record<string, string>, path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: headers(creds) })
  if (res.status === 401 || res.status === 403) throw new Error('invalid_key')
  if (!res.ok) throw new Error(`fathom_${res.status}`)
  return res.json()
}

type MeetingsResponse = { items?: FathomMeeting[]; meetings?: FathomMeeting[]; next_cursor?: string | null; total_count?: number }
type TranscriptResponse = { meeting?: FathomMeeting; transcript?: FathomSegment[]; items?: FathomSegment[] }

export const fathom: Connector = {
  provider: 'fathom',

  async validate(creds) {
    const data = (await get(creds, '/meetings?limit=1')) as MeetingsResponse
    return {
      accountId: `fathom:${(creds.apiKey ?? '').slice(-4)}`,
      callCount: typeof data.total_count === 'number' ? data.total_count : null,
    }
  },

  async listCalls(creds, cursor) {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=25` : '?limit=25'
    const data = (await get(creds, `/meetings${qs}`)) as MeetingsResponse
    const items = data.items ?? data.meetings ?? []
    return {
      calls: items.map(toMeta).filter((c) => c.externalId),
      nextCursor: data.next_cursor ?? null,
    }
  },

  async fetchTranscript(creds, externalId): Promise<TranscriptResult> {
    const data = (await get(creds, `/recordings/${externalId}/transcript`)) as TranscriptResponse
    const meta = toMeta(data.meeting ?? {})
    return { ...meta, externalId, transcript: segmentsToText(data.transcript ?? data.items ?? []) }
  },
}

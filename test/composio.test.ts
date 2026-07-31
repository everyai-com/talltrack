import { describe, expect, it } from 'vitest'
import { isConnected, isNotetaker, NOTETAKER_LABEL, NOTETAKERS } from '../src/ingest/composio'
import { segmentsToText, toMeta } from '../src/ingest/fathom'

describe('notetaker identity', () => {
  it('accepts only the three we support', () => {
    expect(NOTETAKERS.every(isNotetaker)).toBe(true)
    expect(isNotetaker('zoom')).toBe(false)
    // A path parameter reaches these unvalidated, so anything odd must be false
    // rather than merely falsy.
    expect(isNotetaker('../fathom')).toBe(false)
    expect(isNotetaker(undefined)).toBe(false)
    expect(isNotetaker({ toString: () => 'fathom' })).toBe(false)
  })

  it('has a human label for every one', () => {
    for (const p of NOTETAKERS) expect(NOTETAKER_LABEL[p]).toBeTruthy()
  })
})

describe('connection status', () => {
  it('treats only ACTIVE as connected', () => {
    expect(isConnected('ACTIVE')).toBe(true)
    expect(isConnected('active')).toBe(true)
    // Anything else must stay pending. Showing a green tick for an approval
    // that never landed is worse than showing none.
    expect(isConnected('INITIATED')).toBe(false)
    expect(isConnected('FAILED')).toBe(false)
    expect(isConnected('EXPIRED')).toBe(false)
    expect(isConnected('NONE')).toBe(false)
    expect(isConnected('')).toBe(false)
  })
})

describe('reading a fathom call', () => {
  it('prefers the recording start and computes duration', () => {
    const meta = toMeta({
      recording_id: 4242,
      meeting_title: 'Acme review',
      recording_start_time: '2026-07-30T10:00:00Z',
      recording_end_time: '2026-07-30T10:30:00Z',
      share_url: 'https://fathom.video/x',
    })
    expect(meta).toMatchObject({
      externalId: '4242',
      title: 'Acme review',
      occurredAt: '2026-07-30T10:00:00.000Z',
      durationS: 1800,
      providerUrl: 'https://fathom.video/x',
    })
  })

  it('never invents a title or an id', () => {
    const meta = toMeta({})
    expect(meta.title).toBe('Untitled call')
    expect(meta.externalId).toBe('')
    expect(meta.providerUrl).toBeNull()
  })

  it('merges consecutive turns by the same speaker', () => {
    const text = segmentsToText([
      { speaker: 'Priya', text: 'So we looked at it' },
      { speaker: 'Priya', text: 'and the date was wrong.' },
      { speaker: { name: 'Sam' }, text: 'Right.' },
      { speaker: 'Sam', words: 'You signed off already.' },
    ])
    expect(text).toBe('Priya: So we looked at it and the date was wrong.\nSam: Right. You signed off already.')
  })

  it('drops empty segments rather than emitting bare speaker labels', () => {
    expect(segmentsToText([{ speaker: 'Priya', text: '   ' }, { speaker: 'Sam', text: 'Hi' }])).toBe('Sam: Hi')
  })

  it('falls back to a neutral speaker rather than guessing', () => {
    expect(segmentsToText([{ text: 'anonymous line' }])).toBe('Speaker: anonymous line')
  })
})

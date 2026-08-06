import type { CallInput } from '../../src/writer/write'

export const PUBLISHABLE_CALL: CallInput = {
  id: 'fixture-publishable',
  source: 'fathom',
  title: 'The renewal conversation',
  occurredAt: '2026-07-30T10:00:00Z',
  transcript:
    'Buyer: We thought we needed another dashboard.\nFounder: Then you showed us the spreadsheet and the real problem was the handoff between teams.',
}

export const ROUTINE_CALL: CallInput = {
  id: 'fixture-routine',
  source: 'fathom',
  title: 'Weekly status check',
  occurredAt: '2026-07-30T11:00:00Z',
  transcript: 'Founder: The export is on track.\nBuyer: Great, thanks.\nFounder: We will meet again next week.',
}

export const MIXED_PROVIDER_CALLS: CallInput[] = [
  PUBLISHABLE_CALL,
  {
    ...ROUTINE_CALL,
    id: 'fixture-mixed-gong',
    source: 'gong',
    title: 'Gong call with a useful objection',
  },
]

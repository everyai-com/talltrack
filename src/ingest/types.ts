export type CallMeta = {
  externalId: string
  title: string
  /** ISO 8601. */
  occurredAt: string
  durationS: number
  providerUrl: string | null
}

export type TranscriptResult = CallMeta & {
  /** Plain speaker-labelled text. Stored whole; never summarised on the way in. */
  transcript: string
}

export type Connector = {
  provider: 'fathom' | 'gong' | 'fireflies'
  validate(creds: Record<string, string>): Promise<{ accountId: string; callCount: number | null }>
  listCalls(
    creds: Record<string, string>,
    cursor?: string,
  ): Promise<{ calls: CallMeta[]; nextCursor: string | null }>
  fetchTranscript(creds: Record<string, string>, externalId: string): Promise<TranscriptResult>
}

import { useEffect, useState } from 'react'
import type { ProviderCapability } from './App'

type Post = {
  id: string
  body: string
  tension: string
  reach: number
  stranger_takeaway: string | null
  created_at: string
  outcome: 'published' | 'published_after_edit' | 'rejected' | null
  published_body: string | null
}

type WeekData = {
  posts: Post[]
  quiet: { reason: string; call_count: number; created_at: string } | null
  callsStored: number
  profile: { who: string; audience: string; fromCalls: number } | null
}

type SyncResult = {
  provider: string
  readReady: boolean
  found: number
  saved: number
  failed: number
  skippedReason?: string
}

type RunSummary = {
  wrote?: number
  dropped?: number
  nothingBecause?: string | null
  sync?: SyncResult[]
  includedCalls?: Array<{ id: string; title: string; occurredAt: string; source: string }>
  receipt?: { model: string; inputTokens: number; outputTokens: number }
}

/**
 * The front door: this week's posts, or the honest zero with its reason.
 * Feedback lives beside the post so the taste loop never becomes a separate
 * admin screen.
 */
export function ThisWeek({ ready, capabilities }: { ready: boolean; capabilities: Record<string, ProviderCapability> }) {
  const [data, setData] = useState<WeekData | null>(null)
  const [writing, setWriting] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<RunSummary | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editedBody, setEditedBody] = useState('')
  const [savingOutcome, setSavingOutcome] = useState<string | null>(null)

  async function refresh() {
    try {
      const res = await fetch('/api/week')
      if (res.ok) setData((await res.json()) as WeekData)
    } catch {
      /* the status line at the foot of the page covers reachability */
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function write() {
    setWriting(true)
    setError(null)
    setLastRun(null)
    setPhase(data && data.callsStored > 0 ? 'Reading your calls in full…' : 'Pulling your calls in…')

    const later = window.setTimeout(
      () => setPhase('Writing — your Claude is reading everything and thinking. A minute or two.'),
      9000,
    )

    try {
      const res = await fetch('/api/week/write', { method: 'POST' })
      const body = (await res.json()) as RunSummary & { error?: string }
      setLastRun(body)
      if (!res.ok) {
        setError(body.error ?? 'That didn’t work. Try again.')
        return
      }
      await refresh()
    } catch {
      setError('Lost the connection while writing. Check the page in a minute — the work may have landed anyway.')
    } finally {
      window.clearTimeout(later)
      setWriting(false)
      setPhase('')
    }
  }

  async function recordOutcome(post: Post, outcome: 'published' | 'published_after_edit' | 'rejected', body?: string) {
    setSavingOutcome(post.id)
    setError(null)
    try {
      const res = await fetch(`/api/posts/${encodeURIComponent(post.id)}/outcome`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          outcome,
          ...(outcome === 'published_after_edit' ? { publishedBody: body } : {}),
          ...(outcome === 'rejected' ? { rejectReason: 'Skipped from the TallTrack front door.' } : {}),
        }),
      })
      const response = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(response.error ?? 'Couldn’t save that outcome. Try again.')
        return
      }
      setEditing(null)
      await refresh()
    } catch {
      setError('Couldn’t save that outcome. Try again.')
    } finally {
      setSavingOutcome(null)
    }
  }

  const posts = data?.posts ?? []
  const readableCallCount = lastRun?.includedCalls?.length ?? 0

  return (
    <>
      {posts.length > 0 ? (
        <>
          <h1>This week.</h1>
          <p className="lede">
            {posts.length === 1 ? 'One post worth publishing.' : `${posts.length} posts worth publishing.`} Copy what
            you like, then tell me what you did with it.
          </p>
          {posts.map((post) => (
            <article className="card post" key={post.id}>
              <div className="post-head">
                <span className="post-overline">The tension</span>
                <span className="post-meta">
                  {new Date(post.created_at.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                  {' · '}
                  {post.body.length.toLocaleString()} characters
                </span>
              </div>
              <p className="post-tension">{post.tension}</p>
              {(() => {
                const publishedBody = post.outcome === 'published_after_edit' && post.published_body ? post.published_body : post.body
                return editing === post.id ? (
                  <textarea
                    className="edit-body"
                    value={editedBody}
                    onChange={(event) => setEditedBody(event.target.value)}
                    aria-label="The version you published"
                  />
                ) : (
                  <div className="post-body">{publishedBody}</div>
                )
              })()}
              <div className="post-foot">
                {editing === post.id ? (
                  <>
                    <button
                      type="button"
                      className="primary"
                      disabled={savingOutcome === post.id || editedBody.trim().length === 0}
                      onClick={() => void recordOutcome(post, 'published_after_edit', editedBody)}
                    >
                      {savingOutcome === post.id ? 'Saving…' : 'Save published version'}
                    </button>
                    <button type="button" className="link" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        void navigator.clipboard?.writeText(
                          post.outcome === 'published_after_edit' && post.published_body ? post.published_body : post.body,
                        )
                        setCopied(post.id)
                        setTimeout(() => setCopied(null), 1600)
                      }}
                    >
                      {copied === post.id ? 'Copied' : 'Copy'}
                    </button>
                    {!post.outcome && (
                      <div className="outcome-actions" aria-label="What did you do with this post?">
                        <button
                          type="button"
                          className="ghost"
                          disabled={savingOutcome === post.id}
                          onClick={() => void recordOutcome(post, 'published')}
                        >
                          Published
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          disabled={savingOutcome === post.id}
                          onClick={() => {
                            setEditing(post.id)
                            setEditedBody(post.body)
                          }}
                        >
                          Edit &amp; publish
                        </button>
                        <button
                          type="button"
                          className="link outcome-skip"
                          disabled={savingOutcome === post.id}
                          onClick={() => void recordOutcome(post, 'rejected')}
                        >
                          Skip
                        </button>
                      </div>
                    )}
                  </>
                )}
                {post.stranger_takeaway && <span className="fine">A stranger takes away: {post.stranger_takeaway}</span>}
              </div>
              {post.outcome && (
                <p className="outcome-status">
                  {post.outcome === 'published'
                    ? 'Marked published — this becomes a future voice example.'
                    : post.outcome === 'published_after_edit'
                      ? 'Saved as published — the edited version becomes a future voice example.'
                      : 'Skipped. It will not be used as a voice example.'}
                </p>
              )}
            </article>
          ))}
        </>
      ) : (
        <>
          <h1>Nothing to post yet.</h1>
          <p className="lede">
            {data?.quiet
              ? `Last time: ${data.quiet.reason}`
              : 'Once your calls are connected, this is where the week’s posts land — one to three of them, or a straight answer that there wasn’t a story in the calls.'}
          </p>
        </>
      )}

      {lastRun && (
        <div className="card run-summary" aria-live="polite">
          <h2>Last run</h2>
          <p>
            Included {readableCallCount} {readableCallCount === 1 ? 'call' : 'calls'}
            {lastRun.receipt?.model ? ` · ${lastRun.receipt.model}` : ''}
            {lastRun.receipt ? ` · ${lastRun.receipt.inputTokens + lastRun.receipt.outputTokens} tokens` : ''}.
          </p>
          {lastRun.sync?.map((result) => (
            <p className="fine" key={result.provider}>
              {result.skippedReason
                ? result.skippedReason
                : `${result.provider}: found ${result.found}, saved ${result.saved}${result.failed ? `, ${result.failed} failed` : ''}.`}
            </p>
          ))}
          {lastRun.wrote === 0 && lastRun.nothingBecause && <p className="run-reason">No post survived: {lastRun.nothingBecause}</p>}
        </div>
      )}

      {ready ? (
        <div className="card">
          <h2>{posts.length > 0 ? 'Write again' : 'Write this week’s posts'}</h2>
          <p>
            {data?.profile
              ? `It knows you from ${data.profile.fromCalls} of your calls. New calls come in on their own.`
              : 'The first run also reads your calls to learn who you are, who you sell to, and how you talk.'}
          </p>
          <button type="button" className="primary wide" onClick={() => void write()} disabled={writing}>
            {writing ? phase || 'Working…' : 'Read my calls and write'}
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      ) : (
        <div className="card write-blocked">
          <h2>Ready when a readable call recorder is connected</h2>
          <p>
            TallTrack can write from Fathom today. Gong and Fireflies can connect, but their transcript readers are not
            ready yet.
          </p>
          {Object.entries(capabilities)
            .filter(([, capability]) => !capability.readReady)
            .map(([provider, capability]) => (
              <p className="fine" key={provider}>
                {capability.reason}
              </p>
            ))}
        </div>
      )}
      {error && !ready && <p className="error">{error}</p>}
    </>
  )
}

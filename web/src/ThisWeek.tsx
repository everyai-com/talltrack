import { useEffect, useState } from 'react'

type Post = {
  id: string
  body: string
  tension: string
  reach: number
  stranger_takeaway: string | null
  created_at: string
  outcome: string | null
}

type WeekData = {
  posts: Post[]
  quiet: { reason: string; call_count: number; created_at: string } | null
  callsStored: number
  profile: { who: string; audience: string; fromCalls: number } | null
}

/**
 * The front door: this week's posts, or the honest zero with its reason.
 * The write runs on the person's own Claude and takes a minute or two — the
 * waiting copy says what is actually happening, never a bare spinner.
 */
export function ThisWeek({ ready }: { ready: boolean }) {
  const [data, setData] = useState<WeekData | null>(null)
  const [writing, setWriting] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  async function refresh() {
    try {
      const res = await fetch('/api/week')
      setData((await res.json()) as WeekData)
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
    setPhase(data && data.callsStored > 0 ? 'Reading your calls in full…' : 'Pulling your calls in…')

    const later = window.setTimeout(
      () => setPhase('Writing — your Claude is reading everything and thinking. A minute or two.'),
      9000,
    )

    try {
      const res = await fetch('/api/week/write', { method: 'POST' })
      const body = (await res.json()) as { wrote?: number; nothingBecause?: string | null; error?: string }
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

  const posts = data?.posts ?? []

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
              <p className="post-tension">{post.tension}</p>
              <div className="post-body">{post.body}</div>
              <div className="post-foot">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    void navigator.clipboard?.writeText(post.body)
                    setCopied(post.id)
                    setTimeout(() => setCopied(null), 1600)
                  }}
                >
                  {copied === post.id ? 'Copied' : 'Copy'}
                </button>
                {post.stranger_takeaway && <span className="fine">A stranger takes away: {post.stranger_takeaway}</span>}
              </div>
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

      {ready && (
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
      )}
    </>
  )
}

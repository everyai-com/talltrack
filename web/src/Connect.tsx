import { useState } from 'react'

export type Connection = {
  engine: string
  kind: string
  hint: string
  connectedAt: string
  needsRefresh: boolean
}

/**
 * Sign in with Claude, in one click.
 *
 * Click opens Anthropic's approval page in a new tab. They approve, Anthropic
 * shows a short code, they paste it back. The paste box only appears after the
 * tab is open — showing it up front asks for something the person doesn't have
 * yet, which is the fastest way to make a two-step flow feel like homework.
 */
export function Connect({
  connection,
  onConnected,
}: {
  connection: Connection | null
  onConnected: (c: Connection | null) => void
}) {
  const [authId, setAuthId] = useState<string | null>(null)
  // Kept so a blocked popup still has a way through. Losing the URL after
  // window.open leaves the person holding a paste box and no tab to paste from.
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function begin() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/connect/claude/start', { method: 'POST' })
      const data = (await res.json()) as { authId?: string; authorizeUrl?: string; error?: string }
      if (!res.ok || !data.authorizeUrl || !data.authId) {
        setError(data.error ?? 'Couldn’t start sign-in. Try again.')
        return
      }
      setAuthId(data.authId)
      setAuthorizeUrl(data.authorizeUrl)
      window.open(data.authorizeUrl, '_blank', 'noopener,noreferrer')
    } catch {
      setError('Couldn’t reach the service. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function finish(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/connect/claude/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authId, code }),
      })
      const data = (await res.json()) as { connection?: Connection; error?: string }
      if (!res.ok || !data.connection) {
        setError(data.error ?? 'That didn’t work. Try again.')
        return
      }
      setCode('')
      setAuthId(null)
      setAuthorizeUrl(null)
      onConnected(data.connection)
    } catch {
      setError('Couldn’t reach the service. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    await fetch('/api/connect/claude', { method: 'DELETE' })
    onConnected(null)
  }

  if (connection) {
    return (
      <div className="card">
        <h2>Claude connected</h2>
        <p>
          {connection.needsRefresh
            ? `Signed in (${connection.hint}), renewing on the next run.`
            : `Signed in (${connection.hint}). The writing runs on your plan, not ours.`}
        </p>
        <button type="button" className="link" onClick={() => void remove()}>
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <div className="card">
      <h2>Sign in with Claude</h2>
      <p>The writing runs on your own Claude plan. Nothing to install.</p>

      {!authId ? (
        <>
          <button type="button" className="primary wide" onClick={() => void begin()} disabled={busy}>
            {busy ? 'Opening Claude…' : 'Sign in with Claude'}
          </button>
          {error && <p className="error">{error}</p>}
        </>
      ) : (
        <>
          <p className="step">
            Approve it in the tab that just opened, then paste the code Claude shows you.
          </p>
          <form onSubmit={finish}>
            <input
              type="text"
              className="field"
              value={code}
              onChange={(e) => {
                setCode(e.target.value)
                setError(null)
              }}
              placeholder="Paste the code here"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              aria-label="Paste the code Claude showed you"
            />
            <button type="submit" className="primary" disabled={busy || code.trim().length === 0}>
              {busy ? 'Finishing…' : 'Done'}
            </button>
          </form>
          {error && <p className="error">{error}</p>}
          <a className="link" href={authorizeUrl ?? '#'} target="_blank" rel="noopener noreferrer">
            Didn&rsquo;t open? Open the Claude tab
          </a>
        </>
      )}

      <p className="fine">
        Stored encrypted, used only to write your posts, and never shared. You can disconnect any time.
      </p>
    </div>
  )
}

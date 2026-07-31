import { useState } from 'react'

export type Connection = { engine: string; kind: string; hint: string; connectedAt: string }

const COMMAND = 'claude setup-token'

/**
 * Connecting Claude. Two steps, both on one screen, because the whole thing is
 * one action split by a trip to a terminal — and a person who loses the thread
 * between the command and the paste box has to start over.
 */
export function Connect({ connection, onConnected }: { connection: Connection | null; onConnected: (c: Connection) => void }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/connect/claude', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = (await res.json()) as { connection?: Connection; error?: string }
      if (!res.ok || !data.connection) {
        setError(data.error ?? 'That didn’t work. Try again.')
        return
      }
      setToken('')
      onConnected(data.connection)
    } catch {
      setError('Couldn’t reach the service. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (connection) {
    return (
      <div className="card">
        <h2>Claude connected</h2>
        <p>
          {connection.kind === 'subscription' ? 'Your Claude subscription' : 'Your Anthropic key'} ({connection.hint}).
          The writing runs on your plan, not ours.
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <h2>Connect Claude</h2>
      <p>
        The writing runs on your own Claude plan. Run this in a terminal, sign in when it opens your browser, then
        paste what it prints back.
      </p>

      <button
        type="button"
        className="cmd"
        onClick={() => {
          void navigator.clipboard?.writeText(COMMAND)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        }}
      >
        <code>{COMMAND}</code>
        <span className="cmd-hint">{copied ? 'copied' : 'click to copy'}</span>
      </button>

      <form onSubmit={submit}>
        <input
          type="password"
          className="field"
          value={token}
          onChange={(e) => {
            setToken(e.target.value)
            setError(null)
          }}
          placeholder="sk-ant-oat01-…"
          autoComplete="off"
          spellCheck={false}
          aria-label="Paste your Claude token"
        />
        <button type="submit" className="primary" disabled={busy || token.trim().length === 0}>
          {busy ? 'Checking with Claude…' : 'Connect'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      <p className="fine">
        Stored encrypted, used only to write your posts, and never shared. You can disconnect any time.
      </p>
    </div>
  )
}

import { useEffect, useState } from 'react'

type ConnectorInfo = { createdAt: string; lastUsedAt: string | null } | null

/**
 * "Use inside Claude" — one click mints the key and shows the one paste-able
 * command. The key is visible exactly once; after a reload only "made / last
 * used" survives, which is the honest reflection of what the server kept.
 */
export function UseInClaude() {
  const [info, setInfo] = useState<ConnectorInfo>(null)
  const [snippet, setSnippet] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/connector')
      .then((r) => r.json() as Promise<{ connector: ConnectorInfo }>)
      .then((d) => setInfo(d.connector))
      .catch(() => setInfo(null))
  }, [])

  async function mint() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/connector/key', { method: 'POST' })
      const data = (await res.json()) as { claudeCode?: string; error?: string }
      if (!res.ok || !data.claudeCode) {
        setError(data.error ?? 'Couldn’t make the key. Try again.')
        return
      }
      setSnippet(data.claudeCode)
      setInfo({ createdAt: new Date().toISOString(), lastUsedAt: null })
    } catch {
      setError('Couldn’t reach the service. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2>Use it inside Claude</h2>
      <p>
        Paste one command and your calls are available in any Claude conversation — Claude reads the transcripts,
        writes with you, and saves what you approve back here.
      </p>

      {snippet ? (
        <>
          <button
            type="button"
            className="cmd"
            onClick={() => {
              void navigator.clipboard?.writeText(snippet)
              setCopied(true)
              setTimeout(() => setCopied(false), 1600)
            }}
          >
            <code className="wrap">{snippet}</code>
            <span className="cmd-hint">{copied ? 'copied' : 'click to copy'}</span>
          </button>
          <p className="fine">
            Paste it in a terminal where Claude Code is installed. This is the only time the key is shown — making a
            new one replaces it.
          </p>
        </>
      ) : (
        <>
          <button type="button" className="primary wide" onClick={() => void mint()} disabled={busy}>
            {busy ? 'Making your key…' : info ? 'Make a new key' : 'Get the command'}
          </button>
          {info && (
            <p className="fine">
              {info.lastUsedAt
                ? `Connected — last used ${new Date(info.lastUsedAt).toLocaleString()}.`
                : 'A key exists but hasn’t been used yet. Making a new one replaces it.'}
            </p>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  )
}

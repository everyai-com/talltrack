import { useState } from 'react'

export function AuthGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [accessCode, setAccessCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessToken: accessCode }),
      })
      if (!response.ok) {
        setError('That access code didn’t work.')
        return
      }
      setAccessCode('')
      onAuthenticated()
    } catch {
      setError('Couldn’t reach TallTrack. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-gate">
      <p className="brand">
        Tall<span>Track</span>
      </p>
      <div className="card">
        <h1>This is a private workspace.</h1>
        <p className="lede">Enter the access code to see your calls and posts.</p>
        <form onSubmit={submit}>
          <input
            type="password"
            className="field"
            value={accessCode}
            onChange={(event) => {
              setAccessCode(event.target.value)
              setError(null)
            }}
            placeholder="Access code"
            autoComplete="current-password"
            autoFocus
            aria-label="Access code"
          />
          <button type="submit" className="primary" disabled={busy || accessCode.length === 0}>
            {busy ? 'Checking…' : 'Enter TallTrack'}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'

export type NotetakerConnection = {
  provider: string
  status: 'PENDING' | 'ACTIVE'
  connectedAt: string | null
}

const PROVIDERS = [
  { id: 'fathom', label: 'Fathom' },
  { id: 'gong', label: 'Gong' },
  { id: 'fireflies', label: 'Fireflies' },
] as const

const POLL_MS = 2500
/** Roughly two minutes. Long enough to sign in unhurried, short enough to stop. */
const MAX_POLLS = 48

/**
 * Connect a notetaker in one click.
 *
 * The button opens the provider's own sign-in in a new tab; we poll until
 * Composio reports the approval landed. Polling rather than waiting for a
 * redirect is deliberate — the person finishes in the OTHER tab, and there is
 * no reliable way for that tab to hand control back to this one.
 */
export function Notetakers({
  connections,
  onChange,
}: {
  connections: NotetakerConnection[]
  onChange: (next: NotetakerConnection[]) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [waiting, setWaiting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  // A poll left running after the component goes away keeps hitting the API
  // forever and calls setState on something unmounted.
  useEffect(() => () => window.clearTimeout(timer.current ?? undefined), [])

  function poll(provider: string, attempt = 0) {
    timer.current = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/notetakers/${provider}/status`)
          const data = (await res.json()) as { status?: string; error?: string }

          if (data.status === 'ACTIVE') {
            setWaiting(null)
            const list = await fetch('/api/notetakers').then((r) => r.json() as Promise<{ notetakers: NotetakerConnection[] }>)
            onChange(list.notetakers)
            return
          }

          if (attempt >= MAX_POLLS) {
            setWaiting(null)
            setError('That’s taking a while. Finish signing in, then hit connect again.')
            return
          }
          poll(provider, attempt + 1)
        } catch {
          setWaiting(null)
          setError('Lost the connection while checking. Try again.')
        }
      })()
    }, POLL_MS)
  }

  async function start(provider: string) {
    setBusy(provider)
    setError(null)
    try {
      const res = await fetch(`/api/notetakers/${provider}/start`, { method: 'POST' })
      const data = (await res.json()) as { redirectUrl?: string; error?: string }
      if (!res.ok || !data.redirectUrl) {
        setError(data.error ?? 'Couldn’t start that sign-in. Try again.')
        return
      }
      window.open(data.redirectUrl, '_blank', 'noopener,noreferrer')
      setWaiting(provider)
      poll(provider)
    } catch {
      setError('Couldn’t reach the service. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  async function remove(provider: string) {
    await fetch(`/api/notetakers/${provider}`, { method: 'DELETE' })
    onChange(connections.filter((c) => c.provider !== provider))
  }

  const active = connections.filter((c) => c.status === 'ACTIVE')

  return (
    <div className="card">
      <h2>Connect your calls</h2>
      <p>
        {active.length > 0
          ? 'Your calls come in automatically from here.'
          : 'Sign in to wherever your calls are recorded. One is enough.'}
      </p>

      <div className="rows">
        {PROVIDERS.map(({ id, label }) => {
          const conn = connections.find((c) => c.provider === id && c.status === 'ACTIVE')
          return (
            <div className="row" key={id}>
              <span className="row-label">
                {label}
                {conn && <span className="tick"> connected</span>}
              </span>
              {conn ? (
                <button type="button" className="link" onClick={() => void remove(id)}>
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void start(id)}
                  disabled={busy !== null || waiting !== null}
                >
                  {busy === id ? 'Opening…' : waiting === id ? 'Waiting for you…' : 'Connect'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {waiting && <p className="step">Finish signing in on the tab that just opened. This page will notice.</p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

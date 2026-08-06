import { useEffect, useState } from 'react'
import { Connect, type Connection } from './Connect'
import { Notetakers, type NotetakerConnection } from './Notetakers'
import { UseInClaude } from './UseInClaude'
import { ThisWeek } from './ThisWeek'
import { AuthGate } from './AuthGate'

type Health = { ok: boolean; service: string; bindings: Record<string, boolean> }
export type ProviderCapability = { readReady: boolean; reason: string | null }
type AuthStatus = { required: boolean; authenticated: boolean }

/**
 * The front door is "This week" — a post, or an honest nothing. Never a chat
 * box and never a menu (docs/PLAN.md §6). Until a notetaker is connected the
 * honest state is the empty one, said plainly rather than dressed up.
 */
export function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [reachable, setReachable] = useState<boolean | null>(null)
  const [claude, setClaude] = useState<Connection | null>(null)
  const [notetakers, setNotetakers] = useState<NotetakerConnection[]>([])
  const [capabilities, setCapabilities] = useState<Record<string, ProviderCapability>>({})
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)

  useEffect(() => {
    fetch('/api/auth/status')
      .then((r) => r.json() as Promise<AuthStatus>)
      .then(setAuthStatus)
      .catch(() => setAuthStatus({ required: false, authenticated: true }))
  }, [])

  useEffect(() => {
    if (!authStatus?.authenticated) return

    fetch('/api/health')
      .then((r) => r.json() as Promise<Health>)
      .then((h) => {
        setHealth(h)
        setReachable(true)
      })
      .catch(() => setReachable(false))

    fetch('/api/connect')
      .then((r) => r.json() as Promise<{ connections: Connection[] }>)
      .then((d) => setClaude(d.connections.find((c) => c.engine === 'claude') ?? null))
      .catch(() => setClaude(null))

    fetch('/api/notetakers')
      .then((r) => r.json() as Promise<{ notetakers: NotetakerConnection[]; capabilities?: Record<string, ProviderCapability> }>)
      .then((d) => {
        setNotetakers(d.notetakers)
        setCapabilities(d.capabilities ?? {})
      })
      .catch(() => setNotetakers([]))
  }, [authStatus?.authenticated])

  if (!authStatus) {
    return (
      <div className="shell">
        <p className="brand">
          Tall<span>Track</span>
        </p>
        <p className="lede">Checking the workspace…</p>
      </div>
    )
  }

  if (authStatus.required && !authStatus.authenticated) return <AuthGate onAuthenticated={() => setAuthStatus({ ...authStatus, authenticated: true })} />

  const writeReady = notetakers.some((n) => n.status === 'ACTIVE' && capabilities[n.provider]?.readReady)

  return (
    <div className="shell">
      <p className="brand">
        Tall<span>Track</span>
      </p>

      <ThisWeek ready={claude !== null && writeReady} capabilities={capabilities} />

      <Connect connection={claude} onConnected={setClaude} />

      <Notetakers connections={notetakers} capabilities={capabilities} onChange={setNotetakers} />

      <UseInClaude />

      <p className="status">
        <span className={`dot${health?.ok ? ' ok' : ''}`} />
        {reachable === null && 'Checking the service…'}
        {reachable === false && 'Can’t reach the service. Is it running?'}
        {reachable === true &&
          (health?.ok ? 'Service up, storage wired.' : 'Service up, but storage isn’t wired yet.')}
      </p>
    </div>
  )
}

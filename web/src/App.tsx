import { useEffect, useState } from 'react'
import { Connect, type Connection } from './Connect'
import { Notetakers, type NotetakerConnection } from './Notetakers'

type Health = { ok: boolean; service: string; bindings: Record<string, boolean> }

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

  useEffect(() => {
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
      .then((r) => r.json() as Promise<{ notetakers: NotetakerConnection[] }>)
      .then((d) => setNotetakers(d.notetakers))
      .catch(() => setNotetakers([]))
  }, [])

  return (
    <div className="shell">
      <p className="brand">
        Tall<span>Track</span>
      </p>

      <h1>Nothing to post yet.</h1>
      <p className="lede">
        Once your calls are connected, this is where the week&rsquo;s posts land &mdash; one to three of them, or a
        straight answer that there wasn&rsquo;t a story in the calls.
      </p>

      <Connect connection={claude} onConnected={setClaude} />

      <Notetakers connections={notetakers} onChange={setNotetakers} />

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

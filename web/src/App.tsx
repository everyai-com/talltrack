import { useEffect, useState } from 'react'

type Health = { ok: boolean; service: string; bindings: Record<string, boolean> }

/**
 * The front door is "This week" — a post, or an honest nothing. Never a chat
 * box and never a menu (see docs/PLAN.md §6). Right now there is no writer and
 * no notetaker connected, so the honest state is the empty one, said plainly.
 */
export function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [reachable, setReachable] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json() as Promise<Health>)
      .then((h) => {
        setHealth(h)
        setReachable(true)
      })
      .catch(() => setReachable(false))
  }, [])

  return (
    <div className="shell">
      <p className="brand">
        Tall<span>Track</span>
      </p>

      <h1>Nothing to post yet.</h1>
      <p className="lede">
        Once your notetaker is connected, this is where the week&rsquo;s posts land — one to
        three of them, or a straight answer that there wasn&rsquo;t a story in the calls.
      </p>

      <div className="card">
        <h2>Connect your calls</h2>
        <p>Fathom first, then Gong and Fireflies. Not built yet.</p>
      </div>

      <div className="card">
        <h2>Bring your own Claude or Codex</h2>
        <p>The writing runs on your subscription, not ours. Not built yet.</p>
      </div>

      <p className="status">
        <span className={`dot${health?.ok ? ' ok' : ''}`} />
        {reachable === null && 'Checking the service…'}
        {reachable === false && 'Can’t reach the service. Is it running?'}
        {reachable === true &&
          (health?.ok
            ? 'Service up, storage wired.'
            : 'Service up, but storage isn’t wired yet.')}
      </p>
    </div>
  )
}

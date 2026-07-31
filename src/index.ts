import { Hono } from 'hono'
import { health } from './routes/health'
import { connect } from './routes/connect'
import { notetakers } from './routes/notetakers'

// Generated from wrangler.jsonc by `npm run types` into worker-configuration.d.ts.
// Never hand-write this — a binding added to config but missed here is exactly
// the kind of drift that only shows up as `undefined` at runtime.
export type Env = Cloudflare.Env

const app = new Hono<{ Bindings: Env }>()

app.route('/api/health', health)
app.route('/api/connect', connect)
app.route('/api/notetakers', notetakers)

// Anything else under /api is a real miss, not an SPA route. Say so plainly —
// a 404 that renders the app shell is the hardest kind of bug to find.
app.all('/api/*', (c) => c.json({ error: 'no such endpoint' }, 404))

export default app

import { Hono } from 'hono'
import { health } from './routes/health'

// Generated from wrangler.jsonc by `npm run types` into worker-configuration.d.ts.
// Never hand-write this — a binding added to config but missed here is exactly
// the kind of drift that only shows up as `undefined` at runtime.
export type Env = Cloudflare.Env

const app = new Hono<{ Bindings: Env }>()

app.route('/api/health', health)

// Anything else under /api is a real miss, not an SPA route. Say so plainly —
// a 404 that renders the app shell is the hardest kind of bug to find.
app.all('/api/*', (c) => c.json({ error: 'no such endpoint' }, 404))

export default app

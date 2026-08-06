import { Hono } from 'hono'
import { health } from './routes/health'
import { connect } from './routes/connect'
import { notetakers } from './routes/notetakers'
import { connector } from './routes/connector'
import { week } from './routes/week'
import { posts } from './routes/posts'
import { auth } from './routes/auth'
import { demo } from './routes/demo'
import { start } from './routes/start'
import { workspaceForKey } from './mcp/keys'
import { handleMcp } from './mcp/server'
import {
  approve,
  authorizationServerMetadata,
  authorizePage,
  protectedResourceMetadata,
  register,
  token,
  workspaceForOauthToken,
} from './oauth/mcp-oauth'
import { AuthRequiredError, workspaceOf } from './auth'

// Generated from wrangler.jsonc by `npm run types` into worker-configuration.d.ts.
// Never hand-write this — a binding added to config but missed here is exactly
// the kind of drift that only shows up as `undefined` at runtime.
export type Env = Cloudflare.Env

const app = new Hono<{ Bindings: Env }>()

app.use('/api/*', async (c, next) => {
  const path = c.req.path
  if (path === '/api/health' || path.startsWith('/api/auth/')) return next()

  try {
    await workspaceOf(c.req.raw, c.env)
    return next()
  } catch (err) {
    if (err instanceof AuthRequiredError) return c.json({ error: err.message }, 401)
    throw err
  }
})

app.route('/api/health', health)
app.route('/api/auth', auth)
app.route('/api/demo', demo)
app.route('/api/connect', connect)
app.route('/api/notetakers', notetakers)
app.route('/api/connector', connector)
app.route('/api/week', week)
app.route('/api/posts', posts)

// The zero-friction onboarding page — outside /api, so the access gate never
// blocks a stranger from creating their own workspace.
app.route('/start', start)

// OAuth for the public MCP connector: add the bare URL in Claude, approve in
// a browser, and a fresh workspace exists. See src/oauth/mcp-oauth.ts.
app.get('/.well-known/oauth-protected-resource', (c) => protectedResourceMetadata(new URL(c.req.url).origin))
app.get('/.well-known/oauth-protected-resource/mcp', (c) => protectedResourceMetadata(new URL(c.req.url).origin))
app.get('/.well-known/oauth-authorization-server', (c) => authorizationServerMetadata(new URL(c.req.url).origin))
app.post('/oauth/register', (c) => register(c.env, c.req.raw))
app.get('/oauth/authorize', (c) => authorizePage(c.env, c.req.raw))
app.post('/oauth/approve', (c) => approve(c.env, c.req.raw))
app.post('/oauth/token', (c) => token(c.env, c.req.raw))

// The MCP endpoint — TallTrack inside Claude. Deliberately outside /api: it is
// a machine surface with its own auth, and run_worker_first must catch it.
// Two credentials open it: a minted tt_ connector key, or an OAuth access
// token from the public flow above. The 401 carries WWW-Authenticate so a
// bare `claude mcp add <url>` discovers the OAuth server on its own.
app.all('/mcp', async (c) => {
  const authorization = c.req.header('authorization')
  const workspaceId =
    (await workspaceForKey(c.env, authorization)) ?? (await workspaceForOauthToken(c.env, authorization))
  if (!workspaceId) {
    const origin = new URL(c.req.url).origin
    return c.json(
      {
        error: `Connect TallTrack first. In an interactive Claude session, run /mcp and pick talltrack to sign in. In a session that can't open a browser, get a one-paste command with your own key at ${origin}/start instead.`,
      },
      401,
      {
        'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      },
    )
  }
  return handleMcp(c.env, workspaceId, c.req.raw)
})

// Anything else under /api is a real miss, not an SPA route. Say so plainly —
// a 404 that renders the app shell is the hardest kind of bug to find.
app.all('/api/*', (c) => c.json({ error: 'no such endpoint' }, 404))

export default app

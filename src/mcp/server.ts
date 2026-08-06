import { loadCalls } from '../db/calls'
import { loadPublishedExamples } from '../db/posts'
import { getNotetaker, markActive, markPending } from '../db/notetakers'
import {
  ComposioError,
  accountStatus,
  createConnectLink,
  isConnected,
  isNotetaker,
  NOTETAKER_LABEL,
} from '../ingest/composio'
import { PROVIDER_CAPABILITIES, syncActiveNotetakers, type Env as SyncEnv } from '../ingest/sync'
import { audienceContext, loadProfile } from '../profile'
import { checkShape } from '../writer/shape-check'
import { buildEditorialContext } from '../writer/write'

/**
 * TallTrack inside Claude — a remote MCP server, streamable-HTTP, stateless.
 *
 * The design premise: in a Claude conversation, CLAUDE is the writer. These
 * tools hand it the material — whole transcripts and the editorial law — and
 * take the finished post back. No engine call happens server-side, so using
 * TallTrack inside Claude costs nothing beyond the conversation itself.
 *
 * Implemented directly on JSON-RPC rather than the agents SDK: three tools and
 * a fixed contract don't need a Durable Object per session (callcraft's SDK
 * version is 2,127 lines; this is a tenth of that and holds no state at all).
 */

type Env = Pick<Cloudflare.Env, 'DB' | 'TRANSCRIPTS' | 'MASTER_KEY'> & SyncEnv

const PROTOCOL_VERSION = '2025-06-18'

type RpcRequest = { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown> }

const TOOLS = [
  {
    name: 'this_week',
    description:
      'List the calls in this workspace from the last N days (default 7): title, date, duration and id. Call this first to see what material exists. It returns metadata only — use read_call to get a transcript.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'How many days back to look. Default 7, max 31.' },
      },
    },
  },
  {
    name: 'read_call',
    description:
      'Read the WHOLE transcript of one call by id. Read every call you intend to write from, in full, before writing anything — the material that makes a post believable is usually somewhere you would not have looked.',
    inputSchema: {
      type: 'object',
      properties: {
        call_id: { type: 'string', description: 'The id from this_week.' },
      },
      required: ['call_id'],
    },
  },
  {
    name: 'connect_notetaker',
    description:
      'Start connecting a call recorder (fathom, gong or fireflies) to this workspace. Returns a sign-in link — show it to the person and ask them to open it in their browser and approve. Fathom is the one TallTrack can read transcripts from today; say so honestly when they pick another.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'fathom, gong or fireflies. Fathom is the one that can be read today.' },
      },
      required: ['provider'],
    },
  },
  {
    name: 'notetaker_status',
    description:
      'Check whether a notetaker connection finished, and pull in new calls when it has. Call this after the person says they approved the sign-in link from connect_notetaker.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'fathom, gong or fireflies.' },
      },
      required: ['provider'],
    },
  },
  {
    name: 'writing_guide',
    description:
      'The editorial law this workspace writes under, including the measured post SHAPE (one-line hook, short mobile blocks, stacks for receipts) and 24 high-engagement structure references. Fetch it before drafting a post from any call, and follow it exactly — including its permission to conclude there is no post in the material.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'save_post',
    description:
      'Save a finished post to TallTrack so it appears on the workspace front door. Only save a post the person has SEEN and approved in this conversation — never save drafts on your own initiative. The body must be in the measured shape from writing_guide (one-line hook, 1-3 line mobile blocks, stacks for receipts); a dense-paragraph essay is rejected with the specific misses so you can reshape it.',
    inputSchema: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'The post, ready to publish.' },
        tension: { type: 'string', description: 'The one-sentence tension the post is built on.' },
        call_ids: { type: 'array', items: { type: 'string' }, description: 'The calls it came from.' },
      },
      required: ['body', 'tension'],
    },
  },
] as const

function rpcResult(id: number | string | null, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result })
}

function rpcError(id: number | string | null, code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } })
}

function text(payload: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: payload }] }
}

function toolError(payload: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { ...text(payload), isError: true }
}

async function runTool(
  env: Env,
  workspaceId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (name === 'writing_guide') {
    const profile = await loadProfile(env, workspaceId)
    const publishedExamples = await loadPublishedExamples(env, workspaceId)
    return text(
      buildEditorialContext({
        audience: profile ? audienceContext(profile) : undefined,
        publishedExamples,
      }),
    )
  }

  if (name === 'connect_notetaker') {
    const provider = typeof args.provider === 'string' ? args.provider.toLowerCase().trim() : ''
    if (!isNotetaker(provider)) return toolError('Pick one of: fathom, gong, fireflies.')

    const existing = await getNotetaker(env, workspaceId, provider)
    if (existing?.status === 'ACTIVE')
      return text(`${NOTETAKER_LABEL[provider]} is already connected in this workspace.`)

    // Fireflies' native OAuth needs a browser callback flow the web app owns;
    // over MCP we keep to the Composio-hosted providers and say so plainly.
    if (provider === 'fireflies')
      return toolError(
        'Fireflies connects from the TallTrack web page (its sign-in needs a browser callback). Fathom works right here — and it is the provider TallTrack can read transcripts from today.',
      )

    try {
      const { redirectUrl, connectedAccountId } = await createConnectLink(env, provider, workspaceId)
      await markPending(env, workspaceId, provider, connectedAccountId)
      const capability = PROVIDER_CAPABILITIES[provider]
      return text(
        `Ask the person to open this link in their browser and approve:\n\n${redirectUrl}\n\nWhen they say it's done, call notetaker_status with provider "${provider}".${capability.readReady ? '' : `\n\nHonest note: ${capability.reason}`}`,
      )
    } catch (err) {
      if (err instanceof ComposioError) return toolError(err.message)
      throw err
    }
  }

  if (name === 'notetaker_status') {
    const provider = typeof args.provider === 'string' ? args.provider.toLowerCase().trim() : ''
    if (!isNotetaker(provider)) return toolError('Pick one of: fathom, gong, fireflies.')

    const row = await getNotetaker(env, workspaceId, provider)
    if (!row) return text(`${NOTETAKER_LABEL[provider]} has not been started here. Use connect_notetaker first.`)
    if (row.status !== 'ACTIVE') {
      try {
        const status = await accountStatus(env, provider, workspaceId, row.connectedAccountId)
        if (!isConnected(status))
          return text(`Still pending — the sign-in has not been approved yet. Ask the person to finish it in their browser.`)
        await markActive(env, workspaceId, provider)
      } catch (err) {
        if (err instanceof ComposioError) return toolError(err.message)
        throw err
      }
    }

    // Connected — pull calls in right away so this_week has material.
    const results = await syncActiveNotetakers(env, workspaceId)
    const lines = results.map((r) =>
      r.skippedReason ? `${r.provider}: ${r.skippedReason}` : `${r.provider}: found ${r.found}, saved ${r.saved}${r.failed ? `, ${r.failed} failed` : ''}`,
    )
    return text(
      `${NOTETAKER_LABEL[provider]} is connected.\n\n${lines.join('\n')}\n\nList the material with this_week.`,
    )
  }

  if (name === 'this_week') {
    const days = Math.min(31, Math.max(1, typeof args.days === 'number' ? Math.round(args.days) : 7))
    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    const { results } = await env.DB.prepare(
      `select id, title, source, occurred_at from calls
       where workspace_id = ?1 and occurred_at >= ?2 order by occurred_at desc limit 50`,
    )
      .bind(workspaceId, since)
      .all<{ id: string; title: string | null; source: string; occurred_at: string }>()

    const calls = results ?? []
    if (calls.length === 0)
      return text(
        `No calls in the last ${days} days. That is a real answer — do not invent material. The person can connect a notetaker or wait for calls to come in.`,
      )
    return text(
      `${calls.length} call${calls.length === 1 ? '' : 's'} in the last ${days} days. Read every one you intend to write from, in full, with read_call — then fetch writing_guide before drafting.\n\n${JSON.stringify(
        calls.map((c) => ({ id: c.id, title: c.title ?? 'Untitled call', source: c.source, date: c.occurred_at })),
        null,
        2,
      )}`,
    )
  }

  if (name === 'read_call') {
    const callId = typeof args.call_id === 'string' ? args.call_id : ''
    if (!callId) return toolError('call_id is required — get it from this_week.')

    // loadCalls scopes by workspace and decrypts; filter to the one id.
    const all = await loadCalls(env, workspaceId, '1970-01-01T00:00:00Z', 200)
    const call = all.find((c) => c.id === callId)
    if (!call) return toolError('No call with that id in this workspace. List them with this_week.')
    // The length line sets expectations: this is the WHOLE transcript, and the
    // instruction to read it all travels with the material itself.
    return text(
      `# ${call.title} — ${call.occurredAt}\n(${call.transcript.length.toLocaleString()} characters. Read it all — the detail that makes a post believable is usually somewhere you would not have looked.)\n\n${call.transcript}`,
    )
  }

  if (name === 'save_post') {
    const body = typeof args.body === 'string' ? args.body.trim() : ''
    const tension = typeof args.tension === 'string' ? args.tension.trim() : ''
    if (!body || !tension) return toolError('Both body and tension are required.')

    // Deterministic, same spirit as the quote check: a post that reads as a
    // wall of prose never reaches the front door. The misses are specific so
    // the writer can reshape and retry rather than guess.
    const shape = checkShape(body)
    if (!shape.ok)
      return toolError(
        `Not saved — the post misses the measured shape:\n- ${shape.misses.join('\n- ')}\nReshape it (same facts, same tension) and save again.`,
      )

    const callIds = Array.isArray(args.call_ids)
      ? args.call_ids.filter((v): v is string => typeof v === 'string')
      : []

    const id = `post-${crypto.randomUUID()}`
    await env.DB.prepare(
      `insert into posts (id, workspace_id, body, tension, call_ids, reach, craft, stranger_takeaway)
       values (?1, ?2, ?3, ?4, ?5, 0, '{}', null)`,
    )
      .bind(id, workspaceId, body, tension, JSON.stringify(callIds))
      .run()

    return text(
      `Saved. It's on the TallTrack front door now (${id}). Shape: ${shape.hookChars}-char hook, ${shape.shortLinePct}% short lines — inside the measured signature.`,
    )
  }

  return toolError(`No such tool: ${name}`)
}

/**
 * One POST endpoint, stateless. GET (the SSE stream) answers 405 — allowed by
 * the spec for servers that never push, and it keeps this at zero held state.
 */
export async function handleMcp(env: Env, workspaceId: string, request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405 })

  let rpc: RpcRequest
  try {
    rpc = (await request.json()) as RpcRequest
  } catch {
    return rpcError(null, -32700, 'Parse error')
  }

  const id = rpc.id ?? null

  switch (rpc.method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'talltrack', version: '0.1.0' },
      })

    // Notifications get an empty 202 per the streamable-HTTP transport.
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return new Response(null, { status: 202 })

    case 'ping':
      return rpcResult(id, {})

    case 'tools/list':
      return rpcResult(id, { tools: TOOLS })

    case 'tools/call': {
      const params = rpc.params ?? {}
      const name = typeof params.name === 'string' ? params.name : ''
      const args = (params.arguments ?? {}) as Record<string, unknown>
      try {
        return rpcResult(id, await runTool(env, workspaceId, name, args))
      } catch {
        // Tool failures are results, not protocol errors — and never carry
        // internals, because this text lands verbatim in a conversation.
        return rpcResult(id, toolError('That didn’t work. Try again.'))
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${rpc.method ?? '(none)'}`)
  }
}

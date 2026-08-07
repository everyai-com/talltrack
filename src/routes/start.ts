/**
 * The zero-friction front door: https://…/start
 *
 * The OAuth flow is right for interactive Claude sessions, but people hit it
 * from headless runs, CI, scripts, and clients that can't open a browser —
 * and they stall. This page removes every way to get stuck: one click mints
 * a fresh workspace and its connector key, and hands back the COMPLETE
 * `claude mcp add` command with the key baked in. Paste once, works in every
 * kind of session.
 *
 * The key appears exactly once, in the response that renders the command —
 * stored only as SHA-256, same as every connector key.
 */

import { Hono } from 'hono'
import type { Env } from '../index'
import { issueKey } from '../mcp/keys'

const MINTS_PER_IP_PER_DAY = 20

export const start = new Hono<{ Bindings: Env }>()

async function rateLimited(env: Env, request: Request): Promise<boolean> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const key = `mint-limit:${ip}`
  const count = Number((await env.SESSIONS.get(key)) ?? '0')
  if (count >= MINTS_PER_IP_PER_DAY) return true
  await env.SESSIONS.put(key, String(count + 1), { expirationTtl: 24 * 60 * 60 })
  return false
}

start.get('/', (c) => {
  return c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TallTrack — use it inside Claude</title>
<body style="font-family:system-ui;background:#14110f;color:#f0ece7;margin:0;display:grid;place-items:center;min-height:96vh">
<div style="max-width:34em;padding:40px 1.2em">
<p style="font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#a8a09a;margin:0 0 32px">Tall<span style="color:#d97757">Track</span></p>
<h1 style="font-size:1.35rem;margin:0 0 .5em">Sales calls in. Posts worth publishing out.</h1>
<p style="color:#a8a09a;font-size:.95rem;line-height:1.6;margin:0 0 1.6em">One click creates your private workspace and gives you a command to paste into your terminal. After that, everything happens inside Claude: connect your call recorder, and it reads your calls and writes with you.</p>
<button id="go" style="width:100%;padding:13px 16px;background:#d97757;border:1px solid #d97757;border-radius:8px;color:#1a1210;font:inherit;font-weight:600;font-size:15px;cursor:pointer">Create my workspace</button>
<div id="out" hidden>
<p style="color:#f0ece7;font-size:.9rem;margin:1.6em 0 .6em">Paste this into the <strong>Terminal app on your computer</strong> — it is the only time your key is shown:</p>
<p style="color:#a8a09a;font-size:.85rem;line-height:1.5;margin:0 0 .6em">Not into a Claude chat (your key would land in the transcript), and not in a remote or web session (it won't reach your machine). Already added talltrack before? Run <code style="font-family:ui-monospace,monospace">claude mcp remove talltrack</code> first.</p>
<button id="copy" style="width:100%;text-align:left;background:#1c1917;border:1px solid #2e2926;border-radius:8px;padding:14px;cursor:pointer">
<code id="cmd" style="font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:#f0ece7;word-break:break-all;white-space:pre-wrap"></code>
</button>
<p id="copied" style="color:#d97757;font-size:.85rem;margin:.6em 0 0" hidden>Copied.</p>
<p style="color:#a8a09a;font-size:.85rem;line-height:1.55;margin:1.2em 0 0">Then open <code style="font-family:ui-monospace,monospace">claude</code> and say “connect my Fathom”. That's the whole setup.</p>
<p style="color:#a8a09a;font-size:.9rem;margin:1.8em 0 .6em"><strong style="color:#f0ece7">Using Codex instead?</strong> Same workspace, same key — paste these two lines:</p>
<button id="copy2" style="width:100%;text-align:left;background:#1c1917;border:1px solid #2e2926;border-radius:8px;padding:14px;cursor:pointer">
<code id="cmd2" style="font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:#f0ece7;word-break:break-all;white-space:pre-wrap"></code>
</button>
<p id="copied2" style="color:#d97757;font-size:.85rem;margin:.6em 0 0" hidden>Copied.</p>
<p style="color:#a8a09a;font-size:.8rem;line-height:1.5;margin:.8em 0 0">Add the export line to your <code style="font-family:ui-monospace,monospace">~/.zshrc</code> or <code style="font-family:ui-monospace,monospace">~/.bashrc</code> too, so Codex finds the key in future sessions.</p>
</div>
<p id="err" style="color:#e8836a;font-size:.9rem;margin-top:1em" hidden></p>
</div>
<script>
const go=document.getElementById('go'),out=document.getElementById('out'),cmd=document.getElementById('cmd'),err=document.getElementById('err');
go.addEventListener('click',async()=>{
  go.disabled=true;go.textContent='Creating…';
  try{
    const res=await fetch('/start/workspace',{method:'POST'});
    const body=await res.json();
    if(!res.ok){err.textContent=body.error||'That didn’t work. Try again.';err.hidden=false;go.disabled=false;go.textContent='Create my workspace';return}
    cmd.textContent=body.command;
    document.getElementById('cmd2').textContent=body.codexCommand;
    out.hidden=false;go.hidden=true;
  }catch{err.textContent='Lost the connection. Try again.';err.hidden=false;go.disabled=false;go.textContent='Create my workspace'}
});
document.getElementById('copy').addEventListener('click',()=>{
  navigator.clipboard&&navigator.clipboard.writeText(cmd.textContent);
  const c=document.getElementById('copied');c.hidden=false;setTimeout(()=>{c.hidden=true},1600);
});
document.getElementById('copy2').addEventListener('click',()=>{
  navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('cmd2').textContent);
  const c=document.getElementById('copied2');c.hidden=false;setTimeout(()=>{c.hidden=true},1600);
});
</script>`)
})

start.post('/workspace', async (c) => {
  if (await rateLimited(c.env, c.req.raw))
    return c.json({ error: 'Too many workspaces from this connection today. Try again tomorrow.' }, 429)

  const workspaceId = `ws-${crypto.randomUUID()}`
  await c.env.DB.prepare(`insert into workspaces (id, created_via) values (?1, 'start-page')`).bind(workspaceId).run()
  const key = await issueKey(c.env, workspaceId)

  const origin = new URL(c.req.url).origin
  return c.json({
    workspaceId,
    command: `claude mcp add talltrack --transport http ${origin}/mcp --header "Authorization: Bearer ${key}"`,
    // Codex reads the key from an environment variable, never from the config
    // file — its documented pattern for bearer-token MCP servers.
    codexCommand: `export TALLTRACK_KEY="${key}"\ncodex mcp add talltrack --url ${origin}/mcp --bearer-token-env-var TALLTRACK_KEY`,
  })
})

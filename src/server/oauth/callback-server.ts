import http, { type IncomingMessage, type ServerResponse } from 'node:http'

declare global {
  // eslint-disable-next-line no-var
  var __harnessOauthListeners: Map<number, http.Server> | undefined
  // eslint-disable-next-line no-var
  var __harnessOauthFlows: Map<string, PendingFlow> | undefined
}

export type PendingFlow = {
  provider: 'github' | 'codex'
  state: string
  port: number
  redirectUri: string
  pkceVerifier?: string
  startedAt: number
  /** Called by the listener with the raw URL of the callback request. */
  complete: (params: URLSearchParams) => Promise<{ ok: boolean; message: string }>
  /** Resolved by complete() so frontend polling sees a result. */
  resolved?: { ok: boolean; message: string }
}

const FLOW_TTL_MS = 10 * 60 * 1000

function listeners(): Map<number, http.Server> {
  if (!globalThis.__harnessOauthListeners)
    globalThis.__harnessOauthListeners = new Map()
  return globalThis.__harnessOauthListeners
}

function flows(): Map<string, PendingFlow> {
  if (!globalThis.__harnessOauthFlows)
    globalThis.__harnessOauthFlows = new Map()
  return globalThis.__harnessOauthFlows
}

export function registerFlow(flow: PendingFlow) {
  pruneExpired()
  flows().set(flow.state, flow)
}

export function getFlow(state: string): PendingFlow | undefined {
  return flows().get(state)
}

export function popFlow(state: string): PendingFlow | undefined {
  const f = flows().get(state)
  if (f) flows().delete(state)
  return f
}

function pruneExpired() {
  const now = Date.now()
  for (const [state, f] of flows()) {
    if (now - f.startedAt > FLOW_TTL_MS) flows().delete(state)
  }
}

/**
 * Idempotent: ensures a callback http listener is bound on `port`. Multiple
 * pending flows can share a port — they're disambiguated by `state`.
 */
export async function ensureListener(port: number): Promise<void> {
  if (listeners().has(port)) return
  const server = http.createServer(handleRequest)
  await new Promise<void>((resolve, reject) => {
    const onErr = (err: NodeJS.ErrnoException) => {
      server.off('listening', onOk)
      reject(err)
    }
    const onOk = () => {
      server.off('error', onErr)
      resolve()
    }
    server.once('error', onErr)
    server.once('listening', onOk)
    server.listen(port, '0.0.0.0')
  })
  listeners().set(port, server)
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url ?? '/', `http://localhost`)
    if (url.pathname !== '/auth/callback') {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('Not found')
      return
    }
    const state = url.searchParams.get('state')
    if (!state) {
      res.writeHead(400, { 'content-type': 'text/plain' })
      res.end('Missing state parameter')
      return
    }
    const flow = popFlow(state)
    if (!flow) {
      res.writeHead(400, { 'content-type': 'text/html' })
      res.end(failureHtml('Unknown or expired OAuth flow.'))
      return
    }
    const oauthError = url.searchParams.get('error')
    if (oauthError) {
      flow.resolved = {
        ok: false,
        message: url.searchParams.get('error_description') ?? oauthError,
      }
      res.writeHead(400, { 'content-type': 'text/html' })
      res.end(failureHtml(flow.resolved.message))
      return
    }
    const result = await flow.complete(url.searchParams)
    flow.resolved = result
    res.writeHead(result.ok ? 200 : 400, { 'content-type': 'text/html' })
    res.end(
      result.ok
        ? successHtml(`${flow.provider} connected.`)
        : failureHtml(result.message),
    )
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end(`Callback handler error: ${(err as Error).message}`)
  }
}

const PAGE_SHELL = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; padding: 3rem;
      max-width: 32rem; margin: 0 auto; color: #1a1a1a; background: #fafafa; }
    @media (prefers-color-scheme: dark) {
      body { background: #0a0a0a; color: #fafafa; }
    }
    h1 { margin-top: 0; }
    code { font-family: ui-monospace, monospace; }
    .ok { color: #059669; }
    .err { color: #dc2626; }
  </style>
</head>
<body>${body}<p style="margin-top:2rem;font-size:0.85rem;opacity:0.7">You can close this tab.</p></body>
</html>`

function successHtml(message: string) {
  return PAGE_SHELL(
    'Connected · Harness',
    `<h1 class="ok">Done</h1><p>${escapeHtml(message)}</p>`,
  )
}

function failureHtml(message: string) {
  return PAGE_SHELL(
    'OAuth failed · Harness',
    `<h1 class="err">Authorization failed</h1><pre><code>${escapeHtml(message)}</code></pre>`,
  )
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

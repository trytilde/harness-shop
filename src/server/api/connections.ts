import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { CODEX_OAUTH } from '#/lib/oauth-config'
import { getDb, schema } from '#/server/db/client'
import { getFlow, popFlow } from '#/server/oauth/callback-server'
import {
  beginCodexOauth,
  loadCodexProviderConfig,
  saveCodexProviderConfig,
} from '#/server/oauth/codex'
import {
  beginGithubOauth,
  loadGithubProviderConfig,
  saveGithubProviderConfig,
} from '#/server/oauth/github'

export type ProviderId = 'github' | 'codex'

export type ConnectionStatusDto = {
  id: ProviderId
  configured: boolean
  connected: boolean
  callbackUrl: string
  callbackPort: number
  clientIdMasked?: string
  account?: { id?: string; login?: string; avatarUrl?: string }
  connectedAt?: number
}

const githubConfigSchema = z.object({
  clientId: z.string().trim().min(10),
  clientSecret: z.string().trim().min(10),
  callbackUrl: z.string().url(),
})

export const saveGithubConfigFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => githubConfigSchema.parse(d))
  .handler(async ({ data }) => {
    await saveGithubProviderConfig(data)
    return { ok: true as const }
  })

const codexConfigSchema = z.object({
  callbackUrl: z.string().url(),
})

export const saveCodexConfigFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => codexConfigSchema.parse(d))
  .handler(async ({ data }) => {
    await saveCodexProviderConfig(data)
    return { ok: true as const }
  })

export const beginGithubOauthFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    return beginGithubOauth()
  },
)

export const beginCodexOauthFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    return beginCodexOauth()
  },
)

const flowStateSchema = z.object({ state: z.string().min(1) })

export const getOauthFlowStatusFn = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => flowStateSchema.parse(d))
  .handler(async ({ data }) => {
    const flow = getFlow(data.state)
    if (flow) {
      if (flow.resolved) {
        popFlow(data.state)
        return { status: 'done' as const, ...flow.resolved }
      }
      return { status: 'pending' as const }
    }
    // Not in pending map — assume already completed; let client query account.
    return { status: 'unknown' as const }
  })

const manualCallbackSchema = z.object({
  state: z.string().min(1),
  url: z.string().min(1),
})

/**
 * Manual fallback for boxes where the local callback listener isn't reachable
 * (Tailscale, codespaces, etc.). User pastes the full redirect URL; we extract
 * code + state and run the same completion handler as the http listener.
 */
export const completeOauthFromUrlFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => manualCallbackSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: boolean; message: string }> => {
    let parsed: URL
    try {
      parsed = new URL(data.url.trim())
    } catch {
      return { ok: false, message: 'Could not parse that URL.' }
    }
    const params = parsed.searchParams
    const urlState = params.get('state')
    if (!urlState) {
      return {
        ok: false,
        message: 'URL is missing the `state` parameter — paste the full redirect URL.',
      }
    }
    if (urlState !== data.state) {
      return {
        ok: false,
        message: 'State mismatch — this URL is from a different authorization attempt.',
      }
    }
    const flow = popFlow(urlState)
    if (!flow) {
      return {
        ok: false,
        message: 'No pending flow for this state. It may have expired — start over.',
      }
    }
    const oauthError = params.get('error')
    if (oauthError) {
      const result = {
        ok: false,
        message: params.get('error_description') ?? oauthError,
      }
      flow.resolved = result
      return result
    }
    const result = await flow.complete(params)
    flow.resolved = result
    return result
  })

const providerSchema = z.object({ provider: z.enum(['github', 'codex']) })

export const disconnectFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => providerSchema.parse(d))
  .handler(async ({ data }) => {
    const db = await getDb()
    await db
      .delete(schema.oauthAccounts)
      .where(eq(schema.oauthAccounts.id, data.provider))
    return { ok: true as const }
  })

export const getGithubConfigFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const cfg = await loadGithubProviderConfig()
    if (!cfg) return null
    return {
      clientId: cfg.clientId,
      clientIdMasked: maskClientId(cfg.clientId),
      callbackUrl: cfg.callbackUrl,
      callbackPort: cfg.callbackPort,
    }
  },
)

export const getCodexConfigFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const cfg = await loadCodexProviderConfig()
    return {
      clientId: CODEX_OAUTH.clientId,
      clientIdMasked: maskClientId(CODEX_OAUTH.clientId),
      callbackUrl: cfg.callbackUrl,
      callbackPort: cfg.callbackPort,
    }
  },
)

function maskClientId(id: string): string {
  if (id.length <= 8) return '••••' + id.slice(-2)
  return id.slice(0, 4) + '•••••' + id.slice(-4)
}

function portFromCallback(url: string): number {
  try {
    const u = new URL(url)
    if (u.port) return Number(u.port)
    return u.protocol === 'https:' ? 443 : 80
  } catch {
    return 0
  }
}

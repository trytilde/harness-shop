import { CODEX_OAUTH } from '#/lib/oauth-config'
import { getDb, schema } from '#/server/db/client'
import type { ConnectionStatusDto, ProviderId } from '#/server/api/connections'

export async function readConnectionStatuses(): Promise<{
  github: ConnectionStatusDto
  codex: ConnectionStatusDto
}> {
  const db = await getDb()
  const [providers, accounts] = await Promise.all([
    db.select().from(schema.oauthProviders),
    db.select().from(schema.oauthAccounts),
  ])
  const providerById = new Map(providers.map((p) => [p.id as ProviderId, p]))
  const accountById = new Map(accounts.map((a) => [a.id as ProviderId, a]))

  const codexDefault = `http://localhost:${CODEX_OAUTH.callbackPort}${CODEX_OAUTH.redirectPath}`

  const dto = (id: ProviderId, defaultCallback: string): ConnectionStatusDto => {
    const p = providerById.get(id)
    const a = accountById.get(id)
    return {
      id,
      configured: id === 'codex' ? true : Boolean(p?.clientId),
      connected: Boolean(a),
      callbackUrl: p?.callbackUrl ?? defaultCallback,
      callbackPort: p?.callbackPort ?? portFromCallback(defaultCallback),
      clientIdMasked: p?.clientId
        ? maskClientId(p.clientId)
        : id === 'codex'
          ? maskClientId(CODEX_OAUTH.clientId)
          : undefined,
      account: a
        ? {
            id: a.accountId ?? undefined,
            login: a.accountLogin ?? undefined,
            avatarUrl: a.accountAvatarUrl ?? undefined,
          }
        : undefined,
      connectedAt: a?.connectedAt ? a.connectedAt.getTime() : undefined,
    }
  }

  return {
    github: dto('github', 'http://localhost:1456/auth/callback'),
    codex: dto('codex', codexDefault),
  }
}

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


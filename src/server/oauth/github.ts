import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'

import { decrypt, encrypt, isDecryptError } from '#/server/crypto'
import { getDb, schema } from '#/server/db/client'
import { ensureListener, registerFlow } from '#/server/oauth/callback-server'

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const API_BASE = 'https://api.github.com'
const DEFAULT_SCOPES = ['repo', 'read:user']

export type GithubProviderConfig = {
  clientId: string
  clientSecret: string
  callbackUrl: string
  callbackPort: number
}

export async function saveGithubProviderConfig(input: {
  clientId: string
  clientSecret: string
  callbackUrl: string
}) {
  const port = portFromCallback(input.callbackUrl)
  const db = await getDb()
  const now = new Date()
  await db
    .insert(schema.oauthProviders)
    .values({
      id: 'github',
      clientId: input.clientId,
      clientSecretEnc: encrypt(input.clientSecret),
      callbackUrl: input.callbackUrl,
      callbackPort: port,
      configuredAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.oauthProviders.id,
      set: {
        clientId: input.clientId,
        clientSecretEnc: encrypt(input.clientSecret),
        callbackUrl: input.callbackUrl,
        callbackPort: port,
        updatedAt: now,
      },
    })
}

export async function loadGithubProviderConfig(): Promise<GithubProviderConfig | null> {
  const db = await getDb()
  const row = await db.query.oauthProviders.findFirst({
    where: eq(schema.oauthProviders.id, 'github'),
  })
  if (!row || !row.clientId || !row.clientSecretEnc) return null
  let clientSecret: string
  try {
    clientSecret = decrypt(row.clientSecretEnc)
  } catch (e) {
    if (!isDecryptError(e)) throw e
    await db.delete(schema.oauthProviders).where(eq(schema.oauthProviders.id, 'github'))
    return null
  }
  return {
    clientId: row.clientId,
    clientSecret,
    callbackUrl: row.callbackUrl,
    callbackPort: row.callbackPort,
  }
}

export async function beginGithubOauth(): Promise<{
  authorizeUrl: string
  state: string
}> {
  const cfg = await loadGithubProviderConfig()
  if (!cfg)
    throw new Error(
      'GitHub provider is not configured. Save your OAuth App credentials first.',
    )

  await ensureListener(cfg.callbackPort)

  const state = randomBytes(24).toString('base64url')

  registerFlow({
    provider: 'github',
    state,
    port: cfg.callbackPort,
    redirectUri: cfg.callbackUrl,
    startedAt: Date.now(),
    complete: async (params) => completeGithubOauth(cfg, params),
  })

  const authorizeUrl =
    AUTHORIZE_URL +
    '?' +
    new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.callbackUrl,
      scope: DEFAULT_SCOPES.join(' '),
      state,
      allow_signup: 'false',
    }).toString()

  return { authorizeUrl, state }
}

async function completeGithubOauth(
  cfg: GithubProviderConfig,
  params: URLSearchParams,
): Promise<{ ok: boolean; message: string }> {
  const code = params.get('code')
  if (!code) return { ok: false, message: 'GitHub did not return a code.' }

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: cfg.callbackUrl,
    }),
  })

  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    return { ok: false, message: `Token exchange failed: ${text}` }
  }

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string
    token_type?: string
    scope?: string
    error?: string
    error_description?: string
  }

  if (tokenJson.error || !tokenJson.access_token) {
    return {
      ok: false,
      message: tokenJson.error_description ?? tokenJson.error ?? 'No access token.',
    }
  }

  const userRes = await fetch(`${API_BASE}/user`, {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      'User-Agent': 'harness-experiment-runner',
      Accept: 'application/vnd.github+json',
    },
  })
  if (!userRes.ok) {
    return { ok: false, message: `User probe failed: ${userRes.status}` }
  }
  const user = (await userRes.json()) as {
    id: number
    login: string
    avatar_url?: string
  }

  const db = await getDb()
  await db
    .insert(schema.oauthAccounts)
    .values({
      id: 'github',
      accessTokenEnc: encrypt(tokenJson.access_token),
      tokenType: tokenJson.token_type ?? 'bearer',
      scope: tokenJson.scope ?? DEFAULT_SCOPES.join(','),
      accountId: String(user.id),
      accountLogin: user.login,
      accountAvatarUrl: user.avatar_url,
      rawJson: JSON.stringify({ user, token: { scope: tokenJson.scope } }),
      connectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.oauthAccounts.id,
      set: {
        accessTokenEnc: encrypt(tokenJson.access_token),
        tokenType: tokenJson.token_type ?? 'bearer',
        scope: tokenJson.scope ?? DEFAULT_SCOPES.join(','),
        accountId: String(user.id),
        accountLogin: user.login,
        accountAvatarUrl: user.avatar_url,
        rawJson: JSON.stringify({ user, token: { scope: tokenJson.scope } }),
        connectedAt: new Date(),
      },
    })

  return { ok: true, message: `Signed in as ${user.login}` }
}

export async function getGithubAccessToken(): Promise<string | null> {
  const db = await getDb()
  const row = await db.query.oauthAccounts.findFirst({
    where: eq(schema.oauthAccounts.id, 'github'),
  })
  if (!row) return null
  try {
    return decrypt(row.accessTokenEnc)
  } catch (e) {
    if (!isDecryptError(e)) throw e
    await db.delete(schema.oauthAccounts).where(eq(schema.oauthAccounts.id, 'github'))
    throw new Error('GitHub credentials could not be decrypted. Reconnect GitHub in Settings.')
  }
}

function portFromCallback(url: string): number {
  try {
    const u = new URL(url)
    if (u.port) return Number(u.port)
    return u.protocol === 'https:' ? 443 : 80
  } catch {
    return 1456
  }
}

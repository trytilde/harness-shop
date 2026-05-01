import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'

import { encrypt } from '#/server/crypto'
import { getDb, schema } from '#/server/db/client'
import { ensureListener, registerFlow } from '#/server/oauth/callback-server'
import { CODEX_OAUTH } from '#/lib/oauth-config'

const ISSUER = 'https://auth.openai.com'
const SCOPES =
  'openid profile email offline_access api.connectors.read api.connectors.invoke'
/** OpenAI's authorization server validates this for the codex client_id. */
const ORIGINATOR = 'codex_cli_rs'

export type CodexProviderConfig = {
  callbackUrl: string
  callbackPort: number
}

export async function saveCodexProviderConfig(input: { callbackUrl: string }) {
  const port = portFromCallback(input.callbackUrl)
  const db = await getDb()
  const now = new Date()
  await db
    .insert(schema.oauthProviders)
    .values({
      id: 'codex',
      clientId: CODEX_OAUTH.clientId,
      callbackUrl: input.callbackUrl,
      callbackPort: port,
      configuredAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.oauthProviders.id,
      set: {
        clientId: CODEX_OAUTH.clientId,
        callbackUrl: input.callbackUrl,
        callbackPort: port,
        updatedAt: now,
      },
    })
}

export async function loadCodexProviderConfig(): Promise<CodexProviderConfig> {
  const db = await getDb()
  const row = await db.query.oauthProviders.findFirst({
    where: eq(schema.oauthProviders.id, 'codex'),
  })
  if (row) {
    return { callbackUrl: row.callbackUrl, callbackPort: row.callbackPort }
  }
  // Default mirrors the codex CLI exactly.
  const callbackUrl = `http://localhost:${CODEX_OAUTH.callbackPort}${CODEX_OAUTH.redirectPath}`
  return { callbackUrl, callbackPort: CODEX_OAUTH.callbackPort }
}

export async function beginCodexOauth(): Promise<{
  authorizeUrl: string
  state: string
}> {
  const cfg = await loadCodexProviderConfig()
  await ensureListener(cfg.callbackPort)

  const state = randomBytes(32).toString('base64url')
  const codeVerifier = randomBytes(64).toString('base64url')
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')

  registerFlow({
    provider: 'codex',
    state,
    port: cfg.callbackPort,
    redirectUri: cfg.callbackUrl,
    pkceVerifier: codeVerifier,
    startedAt: Date.now(),
    complete: async (params) => completeCodexOauth(cfg, codeVerifier, params),
  })

  const authorizeUrl =
    `${ISSUER}/oauth/authorize?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: CODEX_OAUTH.clientId,
      redirect_uri: cfg.callbackUrl,
      scope: SCOPES,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      state,
      originator: ORIGINATOR,
    }).toString()

  return { authorizeUrl, state }
}

async function completeCodexOauth(
  cfg: CodexProviderConfig,
  verifier: string,
  params: URLSearchParams,
): Promise<{ ok: boolean; message: string }> {
  const code = params.get('code')
  if (!code) return { ok: false, message: 'OpenAI did not return a code.' }

  const tokenRes = await fetch(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.callbackUrl,
      client_id: CODEX_OAUTH.clientId,
      code_verifier: verifier,
    }),
  })
  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    return { ok: false, message: `Token exchange failed (${tokenRes.status}): ${text}` }
  }
  const tokens = (await tokenRes.json()) as {
    id_token?: string
    access_token?: string
    refresh_token?: string
    token_type?: string
    expires_in?: number
  }

  if (!tokens.access_token || !tokens.id_token) {
    return { ok: false, message: 'Missing access_token or id_token in response.' }
  }

  const claims = decodeJwtClaims(tokens.id_token)
  const accountId =
    extractClaim(claims, 'chatgpt_account_id') ??
    extractClaim(claims, 'sub')
  const accountLogin =
    extractClaim(claims, 'email') ?? extractClaim(claims, 'name') ?? 'chatgpt user'

  const db = await getDb()
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null
  await db
    .insert(schema.oauthAccounts)
    .values({
      id: 'codex',
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      idTokenEnc: encrypt(tokens.id_token),
      tokenType: tokens.token_type ?? 'bearer',
      expiresAt: expiresAt ?? undefined,
      accountId: accountId ?? null,
      accountLogin,
      rawJson: JSON.stringify({ claims }),
      connectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.oauthAccounts.id,
      set: {
        accessTokenEnc: encrypt(tokens.access_token),
        refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
        idTokenEnc: encrypt(tokens.id_token),
        tokenType: tokens.token_type ?? 'bearer',
        expiresAt: expiresAt ?? undefined,
        accountId: accountId ?? null,
        accountLogin,
        rawJson: JSON.stringify({ claims }),
        connectedAt: new Date(),
      },
    })

  return { ok: true, message: `Signed in as ${accountLogin}` }
}

function decodeJwtClaims(jwt: string): Record<string, unknown> {
  try {
    const part = jwt.split('.')[1]
    if (!part) return {}
    const json = Buffer.from(part, 'base64url').toString('utf8')
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

function extractClaim(
  claims: Record<string, unknown>,
  key: string,
): string | null {
  const v = claims[key]
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return null
}

function portFromCallback(url: string): number {
  try {
    const u = new URL(url)
    if (u.port) return Number(u.port)
    return u.protocol === 'https:' ? 443 : 80
  } catch {
    return CODEX_OAUTH.callbackPort
  }
}

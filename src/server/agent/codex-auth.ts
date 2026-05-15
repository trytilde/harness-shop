import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

import { eq } from 'drizzle-orm'

import { decrypt, isDecryptError } from '#/server/crypto'
import { getDb, schema } from '#/server/db/client'

/**
 * Per-app CODEX_HOME so we don't stomp the user's real ~/.codex if they're
 * running the codex CLI elsewhere. Defaults to data/codex-home.
 */
function codexHomePath(): string {
  const raw = process.env.HARNESS_CODEX_HOME ?? './data/codex-home'
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw)
}

/**
 * Write `auth.json` with auth_mode=chatgpt using the Codex tokens we captured
 * during the OAuth flow. Returns the CODEX_HOME path on success, or null if
 * the user hasn't connected Codex (in which case the caller should fall back
 * to apikey mode).
 *
 * Schema mirrors `codex-rs/login/src/auth/storage.rs::AuthDotJson`.
 */
export async function materializeChatgptAuthFile(): Promise<string | null> {
  const db = await getDb()
  const row = await db.query.oauthAccounts.findFirst({
    where: eq(schema.oauthAccounts.id, 'codex'),
  })
  if (!row) return null
  let accessToken: string | null = null
  let idToken: string | null = null
  let refreshToken: string | null = null
  try {
    accessToken = row.accessTokenEnc ? decrypt(row.accessTokenEnc) : null
    idToken = row.idTokenEnc ? decrypt(row.idTokenEnc) : null
    refreshToken = row.refreshTokenEnc ? decrypt(row.refreshTokenEnc) : null
  } catch (e) {
    if (!isDecryptError(e)) throw e
    return null
  }
  if (!accessToken || !idToken) return null

  const home = codexHomePath()
  await mkdir(home, { recursive: true })

  const authJson = {
    auth_mode: 'chatgpt' as const,
    OPENAI_API_KEY: null,
    tokens: {
      // The CLI re-parses claims out of the raw JWT — we just hand it back.
      id_token: idToken,
      access_token: accessToken,
      refresh_token: refreshToken ?? '',
      account_id: row.accountId ?? null,
    },
    last_refresh: row.connectedAt.toISOString(),
  }
  await writeFile(
    resolve(home, 'auth.json'),
    JSON.stringify(authJson, null, 2),
    { mode: 0o600 },
  )
  return home
}

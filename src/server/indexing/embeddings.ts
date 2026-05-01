import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'
import { stringify as yamlStringify } from 'yaml'

import { decrypt } from '#/server/crypto'
import { getDb, schema } from '#/server/db/client'
import { deleteSetting, getSetting, setSetting } from '#/server/settings-kv'

const KEYS = {
  openaiApiKey: 'embeddings.openai_api_key', // encrypted
  daemonConfigured: 'embeddings.daemon_configured', // '1' once global_settings.yml is set
} as const

/** The only embedding model we use — fixed by product decision. */
export const EMBEDDING_MODEL = 'openai/text-embedding-3-small'
const PROBE_MODEL = 'text-embedding-3-small'

const GLOBAL_SETTINGS_DIR = join(homedir(), '.cocoindex_code')
const GLOBAL_SETTINGS_PATH = join(GLOBAL_SETTINGS_DIR, 'global_settings.yml')

export type BearerSource = 'codex' | 'apikey'

export async function getOpenaiApiKey(): Promise<string | null> {
  return getSetting(KEYS.openaiApiKey)
}

export async function hasOpenaiApiKey(): Promise<boolean> {
  return Boolean(await getOpenaiApiKey())
}

export async function getCodexAccessToken(): Promise<string | null> {
  const db = await getDb()
  const row = await db.query.oauthAccounts.findFirst({
    where: eq(schema.oauthAccounts.id, 'codex'),
  })
  if (!row) return null
  return decrypt(row.accessTokenEnc)
}

/** POST a 1-token embedding to api.openai.com to validate a bearer. */
export async function probeOpenaiToken(
  token: string,
): Promise<{ ok: true } | { ok: false; status?: number; message: string }> {
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ input: 'ping', model: PROBE_MODEL }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return {
        ok: false,
        status: res.status,
        message: text ? text.slice(0, 280) : res.statusText,
      }
    }
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> }
    if (!json.data?.[0]?.embedding?.length) {
      return { ok: false, message: 'Response had no embedding vector.' }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

/**
 * Pick the bearer we'll inject as OPENAI_API_KEY for cocoindex embeddings.
 *
 * Embeddings work with the Codex/ChatGPT JWT *and* with a real API key. We
 * prefer the JWT so ChatGPT-Plus subscribers don't burn API credits on
 * indexing. The API key is the fallback. (Note: this is for the cocoindex
 * daemon only — the Codex agent uses a different auth path; if it has the
 * JWT it goes through ChatGPT mode via auth.json.)
 */
export async function resolveOpenaiBearer(): Promise<{
  token: string
  source: BearerSource
} | null> {
  const codex = await getCodexAccessToken()
  if (codex) {
    const probe = await probeOpenaiToken(codex)
    if (probe.ok) return { token: codex, source: 'codex' }
  }
  const key = await getOpenaiApiKey()
  if (key) return { token: key, source: 'apikey' }
  return null
}

export type AccessProbe =
  | { ready: true; source: BearerSource }
  | {
      ready: false
      reason: 'needs_key' | 'codex_invalid' | 'apikey_invalid'
      message?: string
    }

/**
 * Used by the experiment-creation gate: decide if we can run the indexer.
 * Prefers the Codex JWT (free for ChatGPT-Plus users), falls back to a
 * saved OpenAI API key.
 */
export async function checkEmbeddingsAccess(): Promise<AccessProbe> {
  const codex = await getCodexAccessToken()
  if (codex) {
    const probe = await probeOpenaiToken(codex)
    if (probe.ok) {
      await ensureDaemonConfigured()
      return { ready: true, source: 'codex' }
    }
  }
  const key = await getOpenaiApiKey()
  if (key) {
    const probe = await probeOpenaiToken(key)
    if (probe.ok) {
      await ensureDaemonConfigured()
      return { ready: true, source: 'apikey' }
    }
    return { ready: false, reason: 'apikey_invalid', message: probe.message }
  }
  return { ready: false, reason: 'needs_key' }
}

export async function saveOpenaiApiKey(apiKey: string): Promise<AccessProbe> {
  const probe = await probeOpenaiToken(apiKey)
  if (!probe.ok) {
    return { ready: false, reason: 'apikey_invalid', message: probe.message }
  }
  await setSetting(KEYS.openaiApiKey, apiKey, { encrypted: true })
  await ensureDaemonConfigured({ force: true })
  return { ready: true, source: 'apikey' }
}

export async function clearOpenaiApiKey() {
  await deleteSetting(KEYS.openaiApiKey)
}

/**
 * Write ~/.cocoindex_code/global_settings.yml with the OpenAI embedding
 * config and stop the daemon, so the next ccc invocation comes up with
 * OPENAI_API_KEY inherited from our spawn env. Idempotent: tracked by a flag
 * in app_settings.
 */
async function ensureDaemonConfigured(opts: { force?: boolean } = {}) {
  if (!opts.force) {
    const flag = await getSetting(KEYS.daemonConfigured)
    if (flag === '1') return
  }
  const settings = {
    embedding: {
      provider: 'litellm',
      model: EMBEDDING_MODEL,
      indexing_params: {},
      query_params: {},
    },
  }
  await mkdir(GLOBAL_SETTINGS_DIR, { recursive: true })
  await writeFile(
    GLOBAL_SETTINGS_PATH,
    `# Managed by Harness. Do not edit by hand.\n` + yamlStringify(settings),
    'utf8',
  )
  await stopDaemon()
  await setSetting(KEYS.daemonConfigured, '1')
}

async function stopDaemon(): Promise<void> {
  return new Promise((resolveProm) => {
    const child = spawn(
      process.env.CCC_BIN || `${homedir()}/.local/bin/ccc`,
      ['daemon', 'stop'],
      {
        env: {
          ...process.env,
          PATH: `${homedir()}/.local/bin:${process.env.PATH ?? ''}`,
        },
        stdio: 'ignore',
      },
    )
    child.on('close', () => resolveProm())
    child.on('error', () => resolveProm())
  })
}

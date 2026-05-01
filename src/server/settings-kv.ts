import { eq } from 'drizzle-orm'

import { decrypt, encrypt } from '#/server/crypto'
import { getDb, schema } from '#/server/db/client'

/**
 * Tiny key/value layer over `app_settings` for app-wide config that doesn't
 * deserve its own table. Pass `encrypted: true` for secrets — they're
 * AES-256-GCM encrypted with the app's token-encryption key.
 */
export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb()
  const row = await db.query.appSettings.findFirst({
    where: eq(schema.appSettings.key, key),
  })
  if (!row || row.value == null) return null
  return row.encrypted ? decrypt(row.value) : row.value
}

export async function setSetting(
  key: string,
  value: string | null,
  options: { encrypted?: boolean } = {},
) {
  const db = await getDb()
  const stored = value == null ? null : options.encrypted ? encrypt(value) : value
  const enc = options.encrypted ? 1 : 0
  await db
    .insert(schema.appSettings)
    .values({
      key,
      value: stored,
      encrypted: enc,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: stored, encrypted: enc, updatedAt: new Date() },
    })
}

export async function deleteSetting(key: string) {
  const db = await getDb()
  await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key))
}

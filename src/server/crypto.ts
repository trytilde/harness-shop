import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'

const ALGO = 'aes-256-gcm' as const
const IV_LEN = 12
const TAG_LEN = 16

/**
 * Derives a 32-byte key from HARNESS_TOKEN_ENCRYPTION_KEY. If the env var is
 * absent or invalid, falls back to a deterministic dev key — fine for local
 * use, but the user should set a real one in .env.local.
 */
function loadKey(): Buffer {
  const raw = process.env.HARNESS_TOKEN_ENCRYPTION_KEY
  if (raw && raw.length > 0) {
    try {
      const buf = Buffer.from(raw, 'base64')
      if (buf.length === 32) return buf
    } catch {}
    return createHash('sha256').update(raw).digest()
  }
  // Deterministic fallback — only used if the user never set one. Stable across
  // restarts so existing rows can still be decrypted.
  return createHash('sha256').update('harness-dev-fallback-key-v1').digest()
}

let cachedKey: Buffer | null = null
function key(): Buffer {
  if (!cachedKey) cachedKey = loadKey()
  return cachedKey
}

/** Encrypt a UTF-8 string. Output is base64(iv|tag|ciphertext). */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

/** Decrypt the output of encrypt(). Throws if tampered or wrong key. */
export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, 'base64')
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = buf.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALGO, key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

export function isDecryptError(error: unknown): boolean {
  const message = (error as Error)?.message ?? ''
  return (
    message.includes('Unsupported state or unable to authenticate data') ||
    message.includes('bad decrypt') ||
    message.includes('unable to decrypt')
  )
}

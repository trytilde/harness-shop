import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  checkEmbeddingsAccess,
  clearOpenaiApiKey,
  hasOpenaiApiKey,
  saveOpenaiApiKey,
  type AccessProbe,
} from '#/server/indexing/embeddings'

export const checkEmbeddingsAccessFn = createServerFn({
  method: 'POST',
}).handler(async (): Promise<AccessProbe> => {
  return checkEmbeddingsAccess()
})

const apiKeySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(20)
    .startsWith('sk-', { message: 'OpenAI keys begin with sk-' }),
})

export const saveOpenaiApiKeyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => apiKeySchema.parse(d))
  .handler(async ({ data }): Promise<AccessProbe> => {
    return saveOpenaiApiKey(data.apiKey)
  })

export const getEmbeddingsStatusFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ hasApiKey: boolean }> => {
    return { hasApiKey: await hasOpenaiApiKey() }
  },
)

export const clearOpenaiApiKeyFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    await clearOpenaiApiKey()
    return { ok: true as const }
  },
)

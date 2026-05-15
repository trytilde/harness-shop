import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, resolve } from 'node:path'

import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import YAML from 'yaml'
import { z } from 'zod'

import { getDb, schema } from '#/server/db/client'

const saveSecretsSchema = z.object({
  experimentId: z.string().min(1),
  providerId: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  values: z.record(z.string(), z.string()),
  file: z.enum(['test_secrets.yaml', 'override_test_secrets.yaml']).default(
    'test_secrets.yaml',
  ),
})

export const saveProviderSecretsFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => saveSecretsSchema.parse(d))
  .handler(async ({ data }): Promise<{ path: string }> => {
    const db = await getDb()
    const exp = await db.query.experiments.findFirst({
      where: eq(schema.experiments.id, data.experimentId),
    })
    if (!exp?.indexId) throw new Error('Experiment has no indexed codebase.')
    const index = await db.query.indexedCodebases.findFirst({
      where: eq(schema.indexedCodebases.id, exp.indexId),
    })
    if (!index?.clonePath) throw new Error('Indexed codebase has no clone path.')

    const clonePath = isAbsolute(index.clonePath)
      ? index.clonePath
      : resolve(process.cwd(), index.clonePath)
    const providerDir = resolve(
      clonePath,
      'providers',
      data.providerId,
    )
    const target = resolve(providerDir, data.file)
    const normalized = normalize(target)
    if (!normalized.startsWith(providerDir)) {
      throw new Error('Refusing to write outside provider directory.')
    }

    await mkdir(providerDir, { recursive: true })
    const yaml = YAML.stringify(data.values)
    await writeFile(target, yaml, { mode: 0o600 })
    return { path: join('providers', data.providerId, data.file) }
  })


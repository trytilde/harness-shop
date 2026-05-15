import { execFile } from 'node:child_process'
import { mkdir, rename, writeFile } from 'node:fs/promises'
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
  values: z.record(z.string(), z.unknown()),
  file: z
    .enum(['test_secrets.yaml', 'override_test_secrets.yaml', 'override_secrets.yaml'])
    .default('override_test_secrets.yaml'),
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
    let draft: Record<string, unknown> = {}
    if (exp.draftJson) {
      try {
        draft = JSON.parse(exp.draftJson) as Record<string, unknown>
      } catch {}
    }
    const existingForm =
      typeof draft.overrideSecretsForm === 'object' && draft.overrideSecretsForm
        ? (draft.overrideSecretsForm as Record<string, unknown>)
        : {}
    draft.overrideSecretsForm = {
      ...existingForm,
      providerId: data.providerId,
      file: data.file,
      savedPath: join('providers', data.providerId, data.file),
      savedAt: Date.now(),
    }
    await db
      .update(schema.experiments)
      .set({ draftJson: JSON.stringify(draft), updatedAt: new Date() })
      .where(eq(schema.experiments.id, data.experimentId))
    return { path: join('providers', data.providerId, data.file) }
  })

const promoteSecretsSchema = z.object({
  experimentId: z.string().min(1),
  providerId: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
})

export const promoteOverrideSecretsFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => promoteSecretsSchema.parse(d))
  .handler(
    async ({
      data,
    }): Promise<{ testSecretsPath: string; encryptedSecretsPath: string }> => {
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
      const providerDir = resolve(clonePath, 'providers', data.providerId)
      const overridePath = resolve(providerDir, 'override_test_secrets.yaml')
      const testPath = resolve(providerDir, 'test_secrets.yaml')
      const encryptedPath = resolve(providerDir, 'test_secrets.enc.yaml')
      for (const path of [overridePath, testPath, encryptedPath]) {
        if (!normalize(path).startsWith(providerDir)) {
          throw new Error('Refusing to write outside provider directory.')
        }
      }

      await rename(overridePath, testPath)
      try {
        await runMakeSopsEncrypt(clonePath, data.providerId)
      } catch (error) {
        const e = error as Error & { stderr?: string; stdout?: string }
        throw new Error(
          [
            'Could not encrypt provider test secrets with SOPS.',
            e.message,
            e.stderr,
            e.stdout,
          ]
            .filter(Boolean)
            .join('\n'),
        )
      }

      let draft: Record<string, unknown> = {}
      if (exp.draftJson) {
        try {
          draft = JSON.parse(exp.draftJson) as Record<string, unknown>
        } catch {}
      }
      const existingForm =
        typeof draft.overrideSecretsForm === 'object' && draft.overrideSecretsForm
          ? (draft.overrideSecretsForm as Record<string, unknown>)
          : {}
      draft.overrideSecretsForm = {
        ...existingForm,
        providerId: data.providerId,
        file: 'override_test_secrets.yaml',
        promotedTo: join('providers', data.providerId, 'test_secrets.yaml'),
        encryptedPath: join('providers', data.providerId, 'test_secrets.enc.yaml'),
        promotedAt: Date.now(),
      }
      await db
        .update(schema.experiments)
        .set({ draftJson: JSON.stringify(draft), updatedAt: new Date() })
        .where(eq(schema.experiments.id, data.experimentId))

      return {
        testSecretsPath: join('providers', data.providerId, 'test_secrets.yaml'),
        encryptedSecretsPath: join(
          'providers',
          data.providerId,
          'test_secrets.enc.yaml',
        ),
      }
    },
  )

function runMakeSopsEncrypt(clonePath: string, providerId: string) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = execFile(
      'make',
      ['sops-encrypt-provider-test-secrets', `PROVIDER=${providerId}`],
      {
        cwd: clonePath,
        env: process.env,
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const e = error as Error & { stdout?: string; stderr?: string }
          e.stdout = stdout
          e.stderr = stderr
          reject(e)
          return
        }
        resolvePromise()
      },
    )
    child.on('error', reject)
  })
}

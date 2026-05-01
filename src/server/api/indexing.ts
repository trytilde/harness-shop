import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { Octokit } from '@octokit/rest'
import { z } from 'zod'

import { getDb, schema } from '#/server/db/client'
import {
  buildAuthCloneUrl,
  clonePathFor,
  runIndexingJob,
} from '#/server/indexing/runner'
import {
  findActiveJobForIndex,
  newJob,
  pruneOldJobs,
} from '#/server/indexing/jobs'
import { cleanupStaleProcessesOnce } from '#/server/indexing/process-tracker'
import { getGithubAccessToken } from '#/server/oauth/github'

const ensureSchema = z.object({
  org: z.string().min(1),
  name: z.string().min(1),
  ref: z.string().min(1),
})

export type IndexEnsureResult = {
  status: 'ready' | 'in_progress'
  indexId: string
  commitSha: string
  jobId: string | null
}

export const ensureIndexedFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => ensureSchema.parse(d))
  .handler(async ({ data }): Promise<IndexEnsureResult> => {
    pruneOldJobs()
    // Sweep orphan ccc pids from a previous server life on first call.
    await cleanupStaleProcessesOnce()

    const token = await getGithubAccessToken()
    if (!token) throw new Error('GitHub is not connected.')
    const oc = new Octokit({ auth: token, userAgent: 'harness-experiment-runner' })

    // Resolve ref → commit sha. Try as branch first, fall back to a generic ref.
    const sha = await resolveSha(oc, data.org, data.name, data.ref)
    const indexId = `${data.org}/${data.name}@${sha}`
    const db = await getDb()

    const existing = await db.query.indexedCodebases.findFirst({
      where: eq(schema.indexedCodebases.id, indexId),
    })
    if (existing?.status === 'ready') {
      return { status: 'ready', indexId, commitSha: sha, jobId: null }
    }

    // Already running? Reuse it.
    const active = findActiveJobForIndex(indexId)
    if (active) {
      return {
        status: 'in_progress',
        indexId,
        commitSha: sha,
        jobId: active.id,
      }
    }

    const clonePath = clonePathFor(data.org, data.name, sha)
    const cloneUrl = await buildAuthCloneUrl(data.org, data.name)

    // Upsert the row in `cloning` state.
    if (existing) {
      await db
        .update(schema.indexedCodebases)
        .set({
          status: 'cloning',
          clonePath,
          startedAt: new Date(),
          completedAt: null,
          errorMessage: null,
        })
        .where(eq(schema.indexedCodebases.id, indexId))
    } else {
      await db.insert(schema.indexedCodebases).values({
        id: indexId,
        repoOrg: data.org,
        repoName: data.name,
        commitSha: sha,
        refValue: data.ref,
        clonePath,
        status: 'cloning',
        startedAt: new Date(),
      })
    }

    const job = newJob({
      indexId,
      org: data.org,
      name: data.name,
      ref: data.ref,
      commitSha: sha,
    })

    // Kick off the runner without awaiting — client will follow progress via SSE.
    void runIndexingJob({
      job,
      clonePath,
      cloneUrl,
      ref: data.ref,
      commitSha: sha,
    })

    return { status: 'in_progress', indexId, commitSha: sha, jobId: job.id }
  })

const indexIdSchema = z.object({ indexId: z.string().min(1) })

export const getIndexFn = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => indexIdSchema.parse(d))
  .handler(async ({ data }) => {
    const db = await getDb()
    const row = await db.query.indexedCodebases.findFirst({
      where: eq(schema.indexedCodebases.id, data.indexId),
    })
    return row ?? null
  })

async function resolveSha(
  oc: Octokit,
  org: string,
  name: string,
  ref: string,
): Promise<string> {
  // Try the ref directly via /repos/.../commits/{ref} which accepts branch,
  // tag, or sha.
  try {
    const { data } = await oc.repos.getCommit({ owner: org, repo: name, ref })
    return data.sha
  } catch {
    // Fall back to branch lookup.
    const { data } = await oc.repos.getBranch({ owner: org, repo: name, branch: ref })
    return data.commit.sha
  }
}

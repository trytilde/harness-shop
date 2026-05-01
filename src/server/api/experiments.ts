import { createServerFn } from '@tanstack/react-start'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { getDb, schema } from '#/server/db/client'
import type {
  Experiment,
  ExperimentDraft,
  ExperimentPhase,
  ExperimentRef,
  ExperimentStatus,
  Metric,
  OutputArtifact,
  SubGoal,
} from '#/lib/types'

export const listExperimentsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Experiment[]> => {
    const db = await getDb()
    const rows = await db
      .select()
      .from(schema.experiments)
      .orderBy(desc(schema.experiments.updatedAt))
    return rows.map(toExperiment)
  },
)

function toExperiment(row: typeof schema.experiments.$inferSelect): Experiment {
  // The draft_json mirrors title/goal, so fall back to it for older rows
  // where the dedicated columns weren't populated yet.
  let draft: { title?: string; goal?: string } = {}
  if (row.draftJson) {
    try {
      draft = JSON.parse(row.draftJson) as typeof draft
    } catch {
      /* ignore */
    }
  }
  return {
    id: row.id,
    repoOrg: row.repoOrg,
    repoName: row.repoName,
    ref: toRef(row),
    title: row.title ?? draft.title ?? '(untitled)',
    goal: row.goal ?? draft.goal ?? '',
    status: row.status as ExperimentStatus,
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toRef(row: typeof schema.experiments.$inferSelect): ExperimentRef {
  if (row.refKind === 'pr') {
    const prNumber = Number(row.refValue)
    return {
      kind: 'pr',
      number: Number.isFinite(prNumber) ? prNumber : 0,
      commit: row.refCommit ?? undefined,
    }
  }
  if (row.refKind === 'commit') {
    return {
      kind: 'commit',
      commit: row.refValue,
    }
  }
  return {
    kind: 'branch',
    branch: row.refValue,
    commit: row.refCommit ?? undefined,
  }
}

const upsertSchema = z.object({
  org: z.string().min(1),
  name: z.string().min(1),
  ref: z.string().min(1),
  indexId: z.string().min(1),
})

/**
 * Always inserts a brand-new experiment row, even if another experiment
 * already exists for the same (repo, ref, indexId). The home table is the
 * place to resume an existing one — *Create experiment* always means a fresh
 * draft.
 */
export const createExperimentForRefFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data }): Promise<{ experimentId: string }> => {
    const db = await getDb()
    const id = `exp_${crypto.randomUUID().slice(0, 12)}`
    await db.insert(schema.experiments).values({
      id,
      repoOrg: data.org,
      repoName: data.name,
      refKind: 'branch',
      refValue: data.ref,
      indexId: data.indexId,
      status: 'draft',
      draftJson: JSON.stringify({
        goal: '',
        subGoals: [],
        artifacts: [],
        harness: { description: '' },
      } satisfies Pick<ExperimentDraft, 'goal' | 'subGoals' | 'artifacts' | 'harness'>),
    })
    return { experimentId: id }
  })

const idSchema = z.object({ experimentId: z.string().min(1) })

const titleUpdateSchema = z.object({
  experimentId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
})

export const updateExperimentTitleFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => titleUpdateSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const db = await getDb()
    // Mirror to draft_json so the home table renders it whichever path
    // toExperiment falls through to.
    const row = await db.query.experiments.findFirst({
      where: eq(schema.experiments.id, data.experimentId),
    })
    let draft: Record<string, unknown> = {}
    if (row?.draftJson) {
      try {
        draft = JSON.parse(row.draftJson) as Record<string, unknown>
      } catch {}
    }
    draft.title = data.title
    await db
      .update(schema.experiments)
      .set({
        title: data.title,
        draftJson: JSON.stringify(draft),
        updatedAt: new Date(),
      })
      .where(eq(schema.experiments.id, data.experimentId))
    return { ok: true }
  })

export const getExperimentByIdFn = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(
    async ({
      data,
    }): Promise<{
      id: string
      repoOrg: string
      repoName: string
      ref: string
      indexId: string | null
      title: string | null
      goal: string | null
      status: ExperimentStatus
      phase: ExperimentPhase
      maxConsecutiveFailures: number | null
    } | null> => {
      const db = await getDb()
      const row = await db.query.experiments.findFirst({
        where: eq(schema.experiments.id, data.experimentId),
      })
      if (!row) return null
      return {
        id: row.id,
        repoOrg: row.repoOrg,
        repoName: row.repoName,
        ref: row.refValue,
        indexId: row.indexId ?? null,
        title: row.title ?? null,
        goal: row.goal ?? null,
        status: row.status as ExperimentStatus,
        phase: (row.phase ?? 'design') as ExperimentPhase,
        maxConsecutiveFailures: row.maxConsecutiveFailures ?? null,
      }
    },
  )

export const getExperimentDraftFn = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(
    async ({
      data,
    }): Promise<{
      experimentId: string
      goal: string
      subGoals: SubGoal[]
      artifacts: OutputArtifact[]
      metrics: Metric[]
      harness: { description: string; code?: string }
      updatedAt: number
    } | null> => {
      const db = await getDb()
      const row = await db.query.experiments.findFirst({
        where: eq(schema.experiments.id, data.experimentId),
      })
      if (!row) return null
      const empty = {
        goal: '',
        subGoals: [] as SubGoal[],
        artifacts: [] as OutputArtifact[],
        metrics: [] as Metric[],
        harness: { description: '' },
      }
      let parsed: typeof empty = empty
      if (row.draftJson) {
        try {
          parsed = { ...empty, ...(JSON.parse(row.draftJson) as typeof empty) }
        } catch {}
      }
      return {
        experimentId: row.id,
        ...parsed,
        updatedAt: row.updatedAt.getTime(),
      }
    },
  )

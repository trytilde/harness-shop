import { createServerFn } from '@tanstack/react-start'
import { sql } from 'drizzle-orm'
import { z } from 'zod'

import { getDb } from '#/server/db/client'
import type { ExperimentRun, RunStatus } from '#/lib/types'

const idSchema = z.object({ experimentId: z.string().min(1) })

type RawRun = {
  id: string
  experiment_id: string
  run_number: number
  status: string
  title: string | null
  summary: string | null
  branch: string | null
  base_commit_sha: string | null
  commit_sha: string | null
  tag: string | null
  error_message: string | null
  started_at: number
  completed_at: number | null
  subgoals_passed: number
  subgoals_total: number
  evaluators_passed: number
  evaluators_total: number
}

export const listRunsFn = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }): Promise<ExperimentRun[]> => {
    const db = await getDb()
    const rows = await db.all<RawRun>(
      sql`
        SELECT r.id, r.experiment_id, r.run_number, r.status,
               r.title, r.summary, r.branch, r.base_commit_sha,
               r.commit_sha, r.tag, r.error_message,
               r.started_at, r.completed_at,
               COALESCE(SUM(CASE WHEN ev.passed = 1 THEN 1 ELSE 0 END), 0) AS evaluators_passed,
               COUNT(ev.id) AS evaluators_total,
               COALESCE(SUM(CASE WHEN ev.passed = 1 THEN 1 ELSE 0 END), 0) AS subgoals_passed,
               COUNT(ev.id) AS subgoals_total
          FROM experiment_runs r
          LEFT JOIN run_evaluator_outcomes ev ON ev.run_id = r.id
         WHERE r.experiment_id = ${data.experimentId}
         GROUP BY r.id
         ORDER BY r.run_number ASC
      `,
    )
    return rows.map(toRun)
  })

function toRun(row: RawRun): ExperimentRun {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    runNumber: row.run_number,
    status: row.status as RunStatus,
    title: row.title,
    summary: row.summary,
    branch: row.branch,
    baseCommitSha: row.base_commit_sha,
    commitSha: row.commit_sha,
    tag: row.tag,
    errorMessage: row.error_message,
    startedAt:
      typeof row.started_at === 'number'
        ? row.started_at * 1000
        : Number(row.started_at),
    completedAt:
      row.completed_at == null
        ? null
        : typeof row.completed_at === 'number'
          ? row.completed_at * 1000
          : Number(row.completed_at),
    subgoalsPassed: Number(row.subgoals_passed ?? 0),
    subgoalsTotal: Number(row.subgoals_total ?? 0),
    evaluatorsPassed: Number(row.evaluators_passed ?? 0),
    evaluatorsTotal: Number(row.evaluators_total ?? 0),
  }
}

export type RunMetricRow = {
  metricId: string
  metricName: string
  unit: string | null
  series: Array<{ runNumber: number; value: number; passed: boolean | null }>
}

export const listRunMetricsFn = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }): Promise<RunMetricRow[]> => {
    const db = await getDb()
    const rows = await db.all<{
      metric_id: string
      metric_name: string
      unit: string | null
      run_number: number
      value: string
      passed: number | null
    }>(
      sql`
        SELECT rm.metric_id, rm.metric_name, rm.unit, r.run_number,
               rm.value, rm.passed
          FROM run_metrics rm
          JOIN experiment_runs r ON r.id = rm.run_id
         WHERE r.experiment_id = ${data.experimentId}
         ORDER BY rm.metric_id, r.run_number ASC
      `,
    )
    const byMetric = new Map<string, RunMetricRow>()
    for (const r of rows) {
      const numeric = Number(r.value)
      if (!Number.isFinite(numeric)) continue
      let bucket = byMetric.get(r.metric_id)
      if (!bucket) {
        bucket = {
          metricId: r.metric_id,
          metricName: r.metric_name,
          unit: r.unit,
          series: [],
        }
        byMetric.set(r.metric_id, bucket)
      }
      bucket.series.push({
        runNumber: r.run_number,
        value: numeric,
        passed: r.passed == null ? null : Boolean(r.passed),
      })
    }
    return Array.from(byMetric.values())
  })

const phaseSchema = z.object({
  experimentId: z.string().min(1),
  phase: z.enum(['design', 'harness', 'runs', 'completed']),
})

export const setExperimentPhaseFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => phaseSchema.parse(d))
  .handler(async ({ data }) => {
    const db = await getDb()
    await db.run(
      sql`UPDATE experiments
            SET phase = ${data.phase},
                status = ${statusForPhase(data.phase)},
                updated_at = unixepoch()
            WHERE id = ${data.experimentId}`,
    )
    return { ok: true as const }
  })

function statusForPhase(phase: 'design' | 'harness' | 'runs' | 'completed') {
  if (phase === 'completed') return 'finished'
  if (phase === 'harness' || phase === 'runs') return 'running'
  return 'draft'
}

const maxFailSchema = z.object({
  experimentId: z.string().min(1),
  maxConsecutiveFailures: z.number().int().min(1).max(50),
})

export const setMaxConsecutiveFailuresFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => maxFailSchema.parse(d))
  .handler(async ({ data }) => {
    const db = await getDb()
    await db.run(
      sql`UPDATE experiments
            SET max_consecutive_failures = ${data.maxConsecutiveFailures},
                updated_at = unixepoch()
            WHERE id = ${data.experimentId}`,
    )
    return { ok: true as const }
  })

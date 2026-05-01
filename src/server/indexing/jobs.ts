import { randomBytes } from 'node:crypto'

export type JobPhase =
  | 'queued'
  | 'cloning'
  | 'cloned'
  | 'initializing'
  | 'indexing'
  | 'ready'
  | 'failed'

export type IndexJobEvent =
  | { type: 'phase'; phase: JobPhase; message?: string }
  | {
      type: 'progress'
      phase: JobPhase
      filesListed?: number
      added?: number
      deleted?: number
      reprocessed?: number
      unchanged?: number
      errors?: number
    }
  | { type: 'log'; line: string }
  | { type: 'done'; indexId: string; chunksCount?: number; filesCount?: number }
  | { type: 'error'; message: string }

export type IndexJob = {
  id: string
  indexId: string
  org: string
  name: string
  ref: string
  commitSha: string
  phase: JobPhase
  createdAt: number
  events: IndexJobEvent[]
  listeners: Set<(e: IndexJobEvent) => void>
}

declare global {
  // eslint-disable-next-line no-var
  var __harnessIndexJobs: Map<string, IndexJob> | undefined
  // eslint-disable-next-line no-var
  var __harnessIndexJobsByIndex: Map<string, string> | undefined
}

function jobs(): Map<string, IndexJob> {
  if (!globalThis.__harnessIndexJobs) globalThis.__harnessIndexJobs = new Map()
  return globalThis.__harnessIndexJobs
}

function byIndex(): Map<string, string> {
  if (!globalThis.__harnessIndexJobsByIndex)
    globalThis.__harnessIndexJobsByIndex = new Map()
  return globalThis.__harnessIndexJobsByIndex
}

export function newJob(args: {
  indexId: string
  org: string
  name: string
  ref: string
  commitSha: string
}): IndexJob {
  const id = randomBytes(8).toString('hex')
  const job: IndexJob = {
    id,
    indexId: args.indexId,
    org: args.org,
    name: args.name,
    ref: args.ref,
    commitSha: args.commitSha,
    phase: 'queued',
    createdAt: Date.now(),
    events: [],
    listeners: new Set(),
  }
  jobs().set(id, job)
  byIndex().set(args.indexId, id)
  return job
}

export function getJob(id: string): IndexJob | undefined {
  return jobs().get(id)
}

export function findActiveJobForIndex(indexId: string): IndexJob | undefined {
  const id = byIndex().get(indexId)
  if (!id) return undefined
  const j = jobs().get(id)
  if (!j) return undefined
  if (j.phase === 'ready' || j.phase === 'failed') return undefined
  return j
}

export function emit(job: IndexJob, event: IndexJobEvent) {
  if (event.type === 'phase') job.phase = event.phase
  if (event.type === 'progress') job.phase = event.phase
  if (event.type === 'done') job.phase = 'ready'
  if (event.type === 'error') job.phase = 'failed'
  job.events.push(event)
  for (const fn of job.listeners) {
    try {
      fn(event)
    } catch {}
  }
}

export function subscribe(job: IndexJob, fn: (e: IndexJobEvent) => void) {
  job.listeners.add(fn)
  return () => job.listeners.delete(fn)
}

/** Cleanup completed jobs older than 30 minutes. */
export function pruneOldJobs() {
  const cutoff = Date.now() - 30 * 60 * 1000
  for (const [id, j] of jobs()) {
    if (
      (j.phase === 'ready' || j.phase === 'failed') &&
      j.createdAt < cutoff
    ) {
      jobs().delete(id)
      byIndex().delete(j.indexId)
    }
  }
}

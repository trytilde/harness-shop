import { eq } from 'drizzle-orm'

import { getDb, schema } from '#/server/db/client'

declare global {
  // eslint-disable-next-line no-var
  var __harnessCccCleanupRan: boolean | undefined
}

export async function recordPid(args: {
  pid: number
  kind: string
  indexId?: string
  jobId?: string
}) {
  const db = await getDb()
  await db
    .insert(schema.cccProcesses)
    .values({
      pid: args.pid,
      kind: args.kind,
      indexId: args.indexId ?? null,
      jobId: args.jobId ?? null,
    })
    .onConflictDoNothing()
}

export async function removePid(pid: number) {
  const db = await getDb()
  await db.delete(schema.cccProcesses).where(eq(schema.cccProcesses.pid, pid))
}

/**
 * On the first call per server lifecycle, kill every pid tracked in
 * ccc_processes and empty the table. Idempotent: subsequent calls return 0.
 *
 * The dev workflow: a previous `pnpm dev` left a `ccc index` running because
 * the parent died abruptly; the cocoindex daemon still holds its lock so any
 * new `ccc index` from the next run sits in "Another indexing is ongoing".
 * Killing the pids and clearing the table releases the daemon lock.
 */
export async function cleanupStaleProcessesOnce(): Promise<number> {
  if (globalThis.__harnessCccCleanupRan) return 0
  globalThis.__harnessCccCleanupRan = true

  const db = await getDb()
  const rows = await db.select().from(schema.cccProcesses)
  if (rows.length === 0) return 0

  console.log(
    `[ccc-cleanup] killing ${rows.length} tracked ccc pid(s) from previous run`,
  )
  let killed = 0
  for (const row of rows) {
    if (await tryKill(row.pid)) killed++
  }

  await db.delete(schema.cccProcesses)
  console.log(`[ccc-cleanup] cleared ${rows.length} row(s); killed ${killed}`)
  return killed
}

async function tryKill(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return false // already gone
  }
  // Give SIGTERM 1.5s to land, then SIGKILL.
  setTimeout(() => {
    try {
      process.kill(pid, 0)
    } catch {
      return // already exited
    }
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }, 1500)
  return true
}

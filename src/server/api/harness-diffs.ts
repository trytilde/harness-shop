import { spawn } from 'node:child_process'

import { createServerFn } from '@tanstack/react-start'
import { sql } from 'drizzle-orm'
import { z } from 'zod'

import { getDb } from '#/server/db/client'

const idSchema = z.object({ experimentId: z.string().min(1) })

export type HarnessDiffFile = {
  path: string
  status: 'added' | 'modified' | 'deleted'
  oldContent: string
  newContent: string
}

/**
 * Returns one entry per file the agent changed in the cloned repo (vs. the
 * indexed sha at HEAD). Front-end renders these with react-diff-viewer.
 */
export const getHarnessDiffsFn = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }): Promise<HarnessDiffFile[]> => {
    const db = await getDb()
    const rows = await db.all<{ clone_path: string }>(
      sql`SELECT ic.clone_path
            FROM experiments e
            JOIN indexed_codebases ic ON ic.id = e.index_id
           WHERE e.id = ${data.experimentId}
           LIMIT 1`,
    )
    const clonePath = rows[0]?.clone_path
    if (!clonePath) return []

    const status = await git(
      ['status', '--porcelain=1', '-uall'],
      clonePath,
    )
    const files = parseStatus(status)
    if (files.length === 0) return []

    const result: HarnessDiffFile[] = []
    for (const f of files) {
      let oldContent = ''
      let newContent = ''
      if (f.status !== 'added') {
        oldContent = await git(['show', `HEAD:${f.path}`], clonePath).catch(
          () => '',
        )
      }
      if (f.status !== 'deleted') {
        newContent = await readWorkingFile(clonePath, f.path)
      }
      // Only emit if the contents actually differ (porcelain can include
      // perm-only changes which don't matter for review).
      if (oldContent === newContent && f.status === 'modified') continue
      result.push({
        path: f.path,
        status: f.status,
        oldContent,
        newContent,
      })
    }
    return result
  })

function parseStatus(out: string): Array<{
  path: string
  status: 'added' | 'modified' | 'deleted'
}> {
  const out2: Array<{ path: string; status: 'added' | 'modified' | 'deleted' }> = []
  for (const raw of out.split('\n')) {
    if (!raw) continue
    // Format: XY <path>  (or XY <orig> -> <renamed>)
    const X = raw[0] ?? ' '
    const Y = raw[1] ?? ' '
    let path = raw.slice(3)
    const arrowIdx = path.indexOf(' -> ')
    if (arrowIdx >= 0) path = path.slice(arrowIdx + 4)
    if (X === '?' || Y === '?') {
      out2.push({ path, status: 'added' })
    } else if (X === 'D' || Y === 'D') {
      out2.push({ path, status: 'deleted' })
    } else if (X === 'A') {
      out2.push({ path, status: 'added' })
    } else {
      out2.push({ path, status: 'modified' })
    }
  }
  return out2
}

async function readWorkingFile(cwd: string, path: string): Promise<string> {
  // Use `cat` via shell to dodge needing fs imports + handle binary refusal.
  // Keep it simple: read text; if it fails, return empty.
  try {
    const { readFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    return await readFile(resolve(cwd, path), 'utf8')
  } catch {
    return ''
  }
}

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolveProm, rejectProm) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (b) => (out += b.toString('utf8')))
    child.stderr.on('data', (b) => (err += b.toString('utf8')))
    child.on('error', rejectProm)
    child.on('close', (code) => {
      if (code === 0) resolveProm(out)
      else rejectProm(new Error(`git ${args[0]} failed: ${err.trim()}`))
    })
  })
}

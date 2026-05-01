import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'

import simpleGit from 'simple-git'
import { eq } from 'drizzle-orm'

import { getDb, schema } from '#/server/db/client'
import { getGithubAccessToken } from '#/server/oauth/github'
import { resolveOpenaiBearer } from '#/server/indexing/embeddings'
import { emit, type IndexJob } from '#/server/indexing/jobs'
import {
  cleanupStaleProcessesOnce,
  recordPid,
  removePid,
} from '#/server/indexing/process-tracker'

export type RunArgs = {
  job: IndexJob
  /** absolute path to clone target */
  clonePath: string
  cloneUrl: string // already includes auth
  ref: string
  commitSha: string
}

const CCC_BIN = process.env.CCC_BIN || `${homedir()}/.local/bin/ccc`

function reposRoot(): string {
  const raw = process.env.HARNESS_REPOS_DIR ?? './data/repos'
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw)
}

export function clonePathFor(org: string, name: string, sha: string): string {
  return resolve(reposRoot(), org, name, sha)
}

export async function buildAuthCloneUrl(
  org: string,
  name: string,
): Promise<string> {
  const token = await getGithubAccessToken()
  if (token)
    return `https://x-access-token:${token}@github.com/${encodeURIComponent(org)}/${encodeURIComponent(name)}.git`
  return `https://github.com/${encodeURIComponent(org)}/${encodeURIComponent(name)}.git`
}

export async function runIndexingJob(args: RunArgs): Promise<void> {
  const { job, clonePath, cloneUrl, ref, commitSha } = args
  const tag = `[index ${job.org}/${job.name}@${commitSha.slice(0, 7)}]`
  // First job after server start sweeps any orphan ccc pids from a previous
  // run before we spawn anything new.
  await cleanupStaleProcessesOnce()
  console.log(`${tag} job ${job.id} starting (clonePath=${clonePath})`)
  const db = await getDb()
  const setStatus = async (
    status: 'cloning' | 'indexing' | 'ready' | 'failed',
    extra: Partial<typeof schema.indexedCodebases.$inferInsert> = {},
  ) => {
    await db
      .update(schema.indexedCodebases)
      .set({ status, ...extra })
      .where(eq(schema.indexedCodebases.id, job.indexId))
  }

  try {
    // 1. Clone
    if (!existsSync(`${clonePath}/.git`)) {
      emit(job, { type: 'phase', phase: 'cloning', message: 'Cloning repository…' })
      await setStatus('cloning')
      await mkdir(dirname(clonePath), { recursive: true })
      // Avoid leaving a half-clone on retry.
      if (existsSync(clonePath)) await rm(clonePath, { recursive: true, force: true })
      const tag = `[git ${job.org}/${job.name}@${job.commitSha.slice(0, 7)}] `
      const git = simpleGit({
        progress: ({ method, stage, progress }) => {
          const line = `git ${method} ${stage} ${progress}%`
          process.stdout.write(`${tag}${line}\n`)
          emit(job, { type: 'log', line })
        },
      })
      // Try to clone the specific branch; if 'ref' is a sha we'll fetch it after.
      await git.clone(cloneUrl, clonePath, [
        '--filter=blob:none',
        '--single-branch',
        '--branch',
        ref,
      ]).catch(async () => {
        // ref may have been a sha; fall back to default branch then checkout sha.
        await git.clone(cloneUrl, clonePath, ['--filter=blob:none'])
      })
      const repo = simpleGit(clonePath)
      try {
        await repo.checkout(commitSha)
      } catch {
        // If we already have the right commit (cloned by branch tip), this throws — ignore.
      }
      // Push safety: detach the clone from its remote so the agent literally
      // cannot `git push`. Experiments stay 100% local.
      try {
        await repo.removeRemote('origin')
      } catch {
        /* no remote — already safe */
      }
    } else {
      emit(job, { type: 'phase', phase: 'cloned', message: 'Reusing existing clone.' })
      // Belt-and-braces for clones from earlier sessions.
      try {
        await simpleGit(clonePath).removeRemote('origin')
      } catch {
        /* no remote */
      }
    }
    emit(job, { type: 'phase', phase: 'cloned' })

    // 2. ccc init (idempotent — settings.yml is reused if present)
    emit(job, { type: 'phase', phase: 'initializing', message: 'Initializing index…' })
    await runCcc(['init', '-f'], clonePath, job)

    // 3. ccc index (the real work)
    emit(job, { type: 'phase', phase: 'indexing', message: 'Indexing codebase…' })
    await setStatus('indexing', { clonePath })
    await runCcc(['index'], clonePath, job)

    // 4. Pull stats from `ccc status`
    const stats = await collectStats(clonePath)
    await setStatus('ready', {
      clonePath,
      filesCount: stats.files ?? null,
      chunksCount: stats.chunks ?? null,
      languageBreakdown: stats.languages
        ? JSON.stringify(stats.languages)
        : null,
      completedAt: new Date(),
    })
    emit(job, {
      type: 'done',
      indexId: job.indexId,
      filesCount: stats.files,
      chunksCount: stats.chunks,
    })
    console.log(
      `${tag} done — ${stats.chunks ?? '?'} chunks across ${stats.files ?? '?'} files`,
    )
  } catch (err) {
    const message = (err as Error).message ?? String(err)
    console.error(`${tag} failed: ${message}`)
    await setStatus('failed', {
      errorMessage: message,
      completedAt: new Date(),
    })
    emit(job, { type: 'error', message })
  }
}

async function runCcc(
  argv: string[],
  cwd: string,
  job: IndexJob,
): Promise<void> {
  const tag = `[ccc ${argv[0]} ${job.org}/${job.name}@${job.commitSha.slice(0, 7)}]`
  // Resolve a bearer for OpenAI embeddings (Codex JWT or saved API key).
  // The daemon picks this up the first time it boots after `ccc daemon stop`.
  const bearer = await resolveOpenaiBearer()
  if (bearer) {
    console.log(`${tag} using ${bearer.source} for OpenAI embeddings`)
  }
  console.log(`${tag} starting (cwd=${cwd})`)
  return new Promise((resolveProm, reject) => {
    const child = spawn(CCC_BIN, argv, {
      cwd,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH ?? ''}`,
        // Force unbuffered stdout/stderr so we see line-by-line progress in
        // real time instead of in 4 KB blocks. Some ccc internals also key
        // off `FORCE_COLOR` for richer output.
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        FORCE_COLOR: '1',
        ...(bearer ? { OPENAI_API_KEY: bearer.token } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // Track the pid so cleanup-on-start can kill it if the dev server dies
    // mid-flight.
    if (typeof child.pid === 'number') {
      void recordPid({
        pid: child.pid,
        kind: argv[0] ?? 'ccc',
        indexId: job.indexId,
        jobId: job.id,
      })
    }

    // Heartbeat so it's obvious we're still alive while ccc is downloading
    // models or warming the daemon and producing no output.
    const startedAt = Date.now()
    const heartbeat = setInterval(() => {
      const secs = Math.round((Date.now() - startedAt) / 1000)
      console.log(`${tag} alive ${secs}s`)
      // Push to the UI too, so the modal doesn't look frozen.
      emit(job, { type: 'log', line: `(still working… ${secs}s)` })
    }, 5000)

    child.on('error', (err) => {
      clearInterval(heartbeat)
      console.error(`${tag} spawn error:`, err.message)
      reject(err)
    })

    let stdoutBuf = ''
    let stderrBuf = ''

    const drainLine = (rawLine: string) => {
      const line = rawLine.trim()
      if (!line) return
      emit(job, { type: 'log', line })
      const m = line.match(
        /Indexing:\s*(\d+)\s*files?\s*listed\s*\|\s*(\d+)\s*added,\s*(\d+)\s*deleted,\s*(\d+)\s*reprocessed,\s*(\d+)\s*unchanged,\s*error:\s*(\d+)/i,
      )
      if (m) {
        emit(job, {
          type: 'progress',
          phase: 'indexing',
          filesListed: Number(m[1]),
          added: Number(m[2]),
          deleted: Number(m[3]),
          reprocessed: Number(m[4]),
          unchanged: Number(m[5]),
          errors: Number(m[6]),
        })
      }
    }

    const handle = (
      chunk: Buffer,
      stream: 'stdout' | 'stderr',
      bufRef: { v: string },
    ) => {
      const text = chunk.toString('utf8')
      // Mirror to Node stdout/stderr, line by line, with a tag prefix.
      // Splitting on \r and \n catches ccc's rolling progress line.
      bufRef.v += text
      const parts = bufRef.v.split(/[\r\n]+/)
      bufRef.v = parts.pop() ?? ''
      for (const part of parts) {
        if (!part) continue
        const sink = stream === 'stderr' ? console.error : console.log
        sink(`${tag} ${part}`)
        drainLine(part)
      }
    }

    const stdoutRef = { v: stdoutBuf }
    const stderrRef = { v: stderrBuf }
    child.stdout.on('data', (c: Buffer) => handle(c, 'stdout', stdoutRef))
    child.stderr.on('data', (c: Buffer) => handle(c, 'stderr', stderrRef))

    child.on('close', (code) => {
      clearInterval(heartbeat)
      if (typeof child.pid === 'number') void removePid(child.pid)
      if (stdoutRef.v.trim()) {
        console.log(`${tag} ${stdoutRef.v.trim()}`)
        drainLine(stdoutRef.v)
      }
      if (stderrRef.v.trim()) {
        console.error(`${tag} ${stderrRef.v.trim()}`)
      }
      const secs = Math.round((Date.now() - startedAt) / 1000)
      console.log(`${tag} exit ${code ?? 'null'} after ${secs}s`)
      if (code === 0) resolveProm()
      else reject(new Error(`ccc ${argv[0]} exited with code ${code}`))
    })
  })
}

async function collectStats(cwd: string): Promise<{
  files?: number
  chunks?: number
  languages?: Record<string, number>
}> {
  return new Promise((resolveProm) => {
    const child = spawn(CCC_BIN, ['status'], {
      cwd,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH ?? ''}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (b) => (out += b.toString('utf8')))
    child.stderr.on('data', (b) => (out += b.toString('utf8')))
    child.on('close', () => {
      const chunksMatch = out.match(/Chunks:\s*(\d+)/i)
      const filesMatch = out.match(/Files:\s*(\d+)/i)
      const langs: Record<string, number> = {}
      const langSection = out.match(/Languages:\s*\n([\s\S]+?)(\n\s*\n|$)/i)
      if (langSection?.[1]) {
        for (const line of langSection[1].split('\n')) {
          const m = line.trim().match(/^(\S+):\s*(\d+)\s*chunks?/i)
          if (m) langs[m[1]] = Number(m[2])
        }
      }
      resolveProm({
        chunks: chunksMatch ? Number(chunksMatch[1]) : undefined,
        files: filesMatch ? Number(filesMatch[1]) : undefined,
        languages: Object.keys(langs).length ? langs : undefined,
      })
    })
    child.on('error', () => resolveProm({}))
  })
}

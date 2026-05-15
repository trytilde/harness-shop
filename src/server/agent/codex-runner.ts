import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import { Codex } from '@openai/codex-sdk'
import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk'
import { sql } from 'drizzle-orm'
import { eq } from 'drizzle-orm'

import { getDb, schema } from '#/server/db/client'
import { materializeChatgptAuthFile } from '#/server/agent/codex-auth'
import {
  getOpenaiApiKey,
  resolveOpenaiBearer,
} from '#/server/indexing/embeddings'
import { getHarnessDefinition } from '#/lib/harness-definitions'
import { buildFirstUserPrompt, buildSystemPrompt } from '#/lib/harness-prompts'

/**
 * Read AGENTS.md and CLAUDE.md from the cloned repo if present and join them
 * into a single string for injection into the bootstrap prompt. Codex auto-
 * loads AGENTS.md on its own, but pulling both into our system message
 * guarantees the agent reads them on the very first turn even before any
 * tool calls run.
 */
async function loadProjectMemory(clonePath: string): Promise<string> {
  const parts: string[] = []
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    try {
      const text = await readFile(join(clonePath, name), 'utf8')
      const trimmed = text.trim()
      if (trimmed.length > 0) {
        parts.push(`### ${name}\n${trimmed}`)
      }
    } catch {
      /* not present — skip */
    }
  }
  return parts.join('\n\n')
}

/** Resolve a path against the *parent* process cwd so that env vars passed
 *  to a child running with a different cwd still point at the right file. */
function resolveAbsolute(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path)
}

/** Stop the cocoindex daemon if it's running so the next `ccc` invocation
 *  spawns a fresh daemon that inherits our OPENAI_API_KEY. */
async function stopCocoindexDaemon(): Promise<void> {
  return new Promise((resolveProm) => {
    const child = spawn(
      process.env.CCC_BIN || `${homedir()}/.local/bin/ccc`,
      ['daemon', 'stop'],
      {
        env: {
          ...process.env,
          PATH: `${homedir()}/.local/bin:${process.env.PATH ?? ''}`,
        },
        stdio: 'ignore',
      },
    )
    child.on('close', () => resolveProm())
    child.on('error', () => resolveProm())
  })
}

const CCC_BIN = process.env.CCC_BIN || `${homedir()}/.local/bin/ccc`

export type AgentEvent =
  | { type: 'thread.started'; threadId: string }
  | { type: 'turn.started' }
  | {
      type: 'item'
      stage: 'started' | 'updated' | 'completed'
      item: ThreadItem
    }
  | { type: 'turn.completed'; usage?: unknown }
  | { type: 'error'; message: string }

export type RunArgs = {
  experimentId: string
  /** User-supplied turn text. For the very first turn pass empty string —
   *  we'll inject the bootstrap prompt instead. */
  userMessage: string
  /** Aborts the underlying codex exec child when the client disconnects. */
  signal?: AbortSignal
}

export async function* runAgentTurn(
  args: RunArgs,
): AsyncGenerator<AgentEvent, void, void> {
  const { experimentId, userMessage, signal } = args

  const db = await getDb()
  // Read via raw SQL so this code path doesn't depend on the Drizzle relational
  // schema being current — HMR sometimes leaves stale schema objects which
  // makes Drizzle silently drop columns that were added in a later iteration.
  const rawExp = await db.all<{
    id: string
    index_id: string | null
    codex_thread_id: string | null
    harness_id: string | null
  }>(
    sql`SELECT id, index_id, codex_thread_id, harness_id FROM experiments WHERE id = ${experimentId} LIMIT 1`,
  )
  const exp = rawExp[0]
  if (!exp) throw new Error(`No experiment row for ${experimentId}`)
  const harness = getHarnessDefinition(exp.harness_id)

  const indexId = exp.index_id
  if (!indexId) throw new Error('experiment.index_id is missing — index first.')

  const rawIndexed = await db.all<{ clone_path: string }>(
    sql`SELECT clone_path FROM indexed_codebases WHERE id = ${indexId} LIMIT 1`,
  )
  const indexed = rawIndexed[0]
  if (!indexed?.clone_path) throw new Error('Indexed codebase has no clone_path.')
  const clonePath = resolve(indexed.clone_path)

  // Auth strategy:
  //   1. If Codex (ChatGPT) is connected, materialise auth.json under our
  //      CODEX_HOME and run the CLI in ChatGPT mode. Routes to
  //      chatgpt.com/backend-api so the JWT works without
  //      `api.responses.write` scope.
  //   2. Otherwise fall back to apikey mode with the saved OpenAI API key.
  const codexHome = await materializeChatgptAuthFile()
  const apiKey = codexHome ? null : await getOpenaiApiKey()
  if (!codexHome && !apiKey) {
    throw new Error(
      'No Codex sign-in or OpenAI API key. Configure one in Settings.',
    )
  }

  // Bearer for the cocoindex daemon (started lazily by the cocoindex_code
  // MCP server child). Without OPENAI_API_KEY in its env the daemon errors
  // out with `litellm.AuthenticationError`. JWT first, API key fallback.
  const embeddingsBearer = await resolveOpenaiBearer()

  // The daemon caches its env from whichever `ccc` invocation first booted
  // it. Stopping it forces the next `ccc mcp` (spawned by codex below) to
  // start a fresh daemon that inherits our injected OPENAI_API_KEY.
  if (embeddingsBearer) await stopCocoindexDaemon()

  const mcpServerScript = resolve('src/mcp-servers/experiment-state.mjs')

  const baseEnv: Record<string, string> = {
    ...process.env,
  } as Record<string, string>
  // In ChatGPT mode we MUST NOT have OPENAI_API_KEY/CODEX_API_KEY in the
  // child env — their presence forces apikey mode regardless of auth.json.
  if (codexHome) {
    delete baseEnv.OPENAI_API_KEY
    delete baseEnv.CODEX_API_KEY
    baseEnv.CODEX_HOME = codexHome
  }

  const codex = new Codex({
    ...(apiKey ? { apiKey } : {}),
    env: baseEnv,
    config: {
      // The third leg of the auto-approve combo (with OnRequest +
      // tool_approval=Approve at the per-server level). With this, the
      // ARC safety monitor is not invoked for MCP tools and approvals are
      // resolved immediately.
      approvals_reviewer: 'auto_review' as const,
      // Codex's workspace-write sandbox protects `.git` as read-only by
      // default, which makes git branch/commit/tag fail with EROFS. Allow
      // writes there explicitly so the agent can run git directly per
      // run-phase instructions. The clone has no `origin` remote (we
      // remove it in the indexing runner) so a stray push isn't possible.
      sandbox_workspace_write: {
        writable_roots: [join(clonePath, '.git')],
        network_access: true,
      },
      mcp_servers: {
        cocoindex_code: {
          command: CCC_BIN,
          args: ['mcp'],
          cwd: clonePath,
          startup_timeout_sec: 30,
          // Pre-approve every tool — cocoindex search is read-only and we
          // can't prompt the user from inside the SDK.
          default_tools_approval_mode: 'approve',
          // Inject the bearer so the cocoindex daemon (litellm) can call
          // OpenAI embeddings. Otherwise we get
          // `AuthenticationError: api_key client option must be set`.
          ...(embeddingsBearer
            ? { env: { OPENAI_API_KEY: embeddingsBearer.token } }
            : {}),
        },
        experiment_state: {
          // Pre-approve every tool — these write to our DB and we
          // explicitly trust them.
          default_tools_approval_mode: 'approve',
          command: process.execPath, // node binary
          args: [mcpServerScript],
          env: {
            HARNESS_EXPERIMENT_ID: experimentId,
            // Resolve the DB path in the *parent's* cwd before forwarding;
            // the MCP child runs with a different cwd (codex sets it to the
            // cloned repo) so a relative path would land in a different dir
            // and we'd open an empty DB without our `experiments` table.
            HARNESS_DB_URL: process.env.HARNESS_DB_URL ?? '',
            HARNESS_DB_PATH: resolveAbsolute(
              process.env.HARNESS_DB_PATH ?? './data/harness.db',
            ),
            HARNESS_DB_AUTH_TOKEN: process.env.HARNESS_DB_AUTH_TOKEN ?? '',
            HARNESS_TOKEN_ENCRYPTION_KEY:
              process.env.HARNESS_TOKEN_ENCRYPTION_KEY ?? '',
            // Lets the MCP server's git_* tools shell out at the right path.
            HARNESS_CLONE_PATH: clonePath,
          },
          startup_timeout_sec: 15,
        },
      },
    },
  })

  // Decide whether to resume or start fresh:
  //   - empty userMessage → bootstrap call from the client; always start a new
  //     thread so a half-baked `codex_thread_id` from an earlier failed attempt
  //     can't poison the run.
  //   - userMessage present + thread_id exists → resume.
  //   - userMessage present + no thread_id → start fresh (rare).
  const trimmedMsg = userMessage.trim()
  const resume = Boolean(exp.codex_thread_id) && trimmedMsg.length > 0

  if (!resume && exp.codex_thread_id) {
    // Clear the stale id so subsequent reads see the new thread.started event.
    await db
      .update(schema.experiments)
      .set({ codexThreadId: null })
      .where(eq(schema.experiments.id, experimentId))
  }

  // Same option set used for both startThread and resumeThread — the SDK
  // *does not* persist these across thread sessions, so resuming with no
  // options silently falls back to the CLI defaults (read-only sandbox,
  // approval prompts on). That made the agent's harness-phase edits fail
  // with "writing is blocked by read-only sandbox" mid-turn.
  // Auto-approve every MCP tool + every escalation without showing a
  // prompt. Codex's auto-approve fast path (codex-mcp/src/mcp/mod.rs:74)
  // fires only when approval_policy is OnRequest *and* approvals_reviewer
  // is AutoReview *and* tool_approval_mode is Approve — otherwise it falls
  // through to the safety monitor or a user prompt that we can't answer
  // headlessly, which surfaces as "user cancelled MCP tool call".
  const threadOptions = {
    workingDirectory: clonePath,
    skipGitRepoCheck: true,
    sandboxMode: 'workspace-write' as const,
    approvalPolicy: 'on-request' as const,
    networkAccessEnabled: true,
  }
  let thread = resume
    ? codex.resumeThread(exp.codex_thread_id!, threadOptions)
    : codex.startThread(threadOptions)

  // On a new thread we always send the bootstrap (system + first instructions)
  // — appending the user's text if they sent any. On resume, just the user
  // message verbatim.
  const projectMemory = !resume ? await loadProjectMemory(clonePath) : ''
  const prompt = resume
    ? trimmedMsg
    : `${buildSystemPrompt(harness)}${
        projectMemory
          ? `\n\n--- PROJECT MEMORY (verbatim from repo) ---\n${projectMemory}`
          : ''
      }\n\n${buildFirstUserPrompt(harness)}${
        trimmedMsg ? '\n\n--- USER FOLLOW-UP ---\n' + trimmedMsg : ''
      }`

  const { events } = await thread.runStreamed(prompt, { signal })

  for await (const event of events as AsyncIterable<ThreadEvent>) {
    if (event.type === 'thread.started') {
      // Persist thread id so subsequent turns resume.
      await db
        .update(schema.experiments)
        .set({ codexThreadId: event.thread_id, updatedAt: new Date() })
        .where(eq(schema.experiments.id, experimentId))
      yield { type: 'thread.started', threadId: event.thread_id }
    } else if (event.type === 'turn.started') {
      yield { type: 'turn.started' }
    } else if (event.type === 'item.started') {
      yield { type: 'item', stage: 'started', item: event.item }
    } else if (event.type === 'item.updated') {
      yield { type: 'item', stage: 'updated', item: event.item }
    } else if (event.type === 'item.completed') {
      yield { type: 'item', stage: 'completed', item: event.item }
    } else if (event.type === 'turn.completed') {
      yield { type: 'turn.completed', usage: event.usage }
    } else if (event.type === 'turn.failed') {
      yield { type: 'error', message: event.error.message }
    } else if (event.type === 'error') {
      yield { type: 'error', message: event.message }
    }
  }
}

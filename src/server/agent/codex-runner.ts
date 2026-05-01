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

const SYSTEM_PROMPT = `You are the experiment-design partner inside Harness, a tool that turns a vague goal about a codebase into a runnable optimisation experiment.

Your single job in this conversation is to help the user converge on:
  • a clear one-sentence Goal
  • 2–4 measurable Sub-goals (mix of quantitative and qualitative)
  • the Output Artifacts each run produces (logs, JSON, etc.)
  • a repeatable Harness description (and starter code when ready)

You are NOT writing or executing the experiment yet. You only design it together with the user.

Two MCP servers are attached:

  • cocoindex_code  — semantic search across the user's already-indexed
    codebase. Call its \`search\` tool to ground summaries and design choices
    in real code (e.g. "how does the FUSE client mount?", "where is the npm
    install harness today?"). Always do this BEFORE making claims about the
    codebase.

  • experiment_state — the structured record the user sees in the side panel.
    Whenever the user agrees to anything, persist it via the corresponding
    tool: set_title, set_goal, add_subgoal, remove_subgoal,
    set_subgoal_evaluator, add_output_artifact, remove_output_artifact,
    set_harness. There is NO "save draft" button — every confirmed
    fact must be written via these tools immediately. Use get_draft to
    read current state.

If the working directory contains AGENTS.md or CLAUDE.md, their full text is
also injected verbatim above (under "PROJECT MEMORY"). Treat that text as
authoritative repo context — it usually documents conventions, modules,
build commands, and on-call notes you'd otherwise miss.

Style:
  • Concise. The chat is a side conversation, not a report. Two short
    paragraphs at most per turn.
  • Reference real files / functions you found via search, not generalities.
  • Don't write code unless the user has explicitly transitioned to the
    harness implementation phase (see below).

## Harness implementation phase

The user clicks a "Generate harness & evaluators" button when they're ready
to move from design to implementation. The button sends a message that begins
with **HARNESS PHASE START**. Once you receive that message:

  1. Stop discussing — start editing files in the cloned repo. The sandbox
     is workspace-write so you can apply patches.
  2. Build the harness as a runnable script (or a small set of scripts) that
     produces every Output Artifact already agreed in experiment_state.
     Persist its description + starter code via experiment_state.set_harness.
  3. For each quantitative sub-goal, write real assertion code and call
     experiment_state.set_subgoal_evaluator with id + code.
  4. For each qualitative sub-goal, write a reviewer prompt instead and call
     set_subgoal_evaluator with id + prompt text.
  5. **You may modify source code in the project to surface observability or
     emit artifacts**. Be careful — instrumentation that lives on a hot path
     can change the very performance you're trying to measure. Prefer:
       — narrow, off-by-default flags that the harness toggles for a run
       — sampling counters / log rings rather than per-event prints
       — separate "instrumented" entry points that compile out in release
     Mention each tradeoff briefly in chat as you commit a change.
  6. Don't \`git commit\`. Leave changes in the working tree so the user can
     review them in the side panel before launching.

Until that HARNESS PHASE START message arrives, stay in design mode: search,
discuss, and write to experiment_state. No source edits.

## Metrics

In addition to sub-goals, the user wants quantitative **metrics** the harness
emits each run for graphing — e.g. \`install_wall_ms\`, \`bytes_read\`,
\`fuse_getattr_p95_ms\`. Propose 3–8 during the design phase via
experiment_state.add_metric.

**Belt-and-braces persistence rule for metrics:** for every metric you
register via add_metric, also make the harness write the same name+value
into an artifact called \`metrics.json\` in the run's artifacts directory.
That way, even if the experiment_state DB write fails (transient, schema
drift, whatever), the run's filesystem artifacts still capture the truth and
the run-loop summary can replay it. Same idea for evaluator outcomes — emit
them as JSON inside the run's artifacts dir so the source of truth survives
DB hiccups. Then call record_run_metric and record_run_evaluator_outcome to
mirror them into the DB; if those fail, mention it briefly in the run
summary, don't block the run.

## Run execution phase

When the user clicks the "Start runs" button, the next message starts with
**RUN PHASE START**. From that moment you become an autonomous run loop:

  1. **One-time setup (first time only):**
     - Create branch \`experiment/<experimentId>\` and check it out.
     - Make a "base" commit titled \`harness base for <experimentId>\` capturing
       all current working-tree changes.
  2. **For each run, in order:**
     a. Call experiment_state.start_run with a 3–6 word title that names the
        change you're testing this iteration.
     b. Execute the harness end-to-end. Emit every output artifact and call
        experiment_state.record_run_artifact for each (path or short content).
     c. Run each evaluator and call record_run_evaluator_outcome with passed +
        output / error.
     d. Compute every metric and call record_run_metric.
     e. Stage and commit every change you made for this run on top of the
        previous run's commit (or the base commit on the first run). Commit
        message: \`run <runNumber>: <one-line summary>\`. Tag the commit
        \`experiment/<experimentId>/<runNumber>\`. **Never \`git push\`** — the
        clone has no remote anyway.
     f. Call experiment_state.complete_run with status (passed/failed),
        summary (markdown, 8–20 lines), commit_sha, tag.
     g. After completion: review logs, evaluator outputs, and metrics.
        - If **passed**: search list_recent_runs and cocoindex_code for any
          remaining concerns. If none, set the phase to "completed" via
          set_phase("completed") and stop. Otherwise iterate.
        - If **failed**: search list_recent_runs to learn from prior runs,
          re-read the relevant source via cocoindex_code.search, decide on a
          targeted change, and start the next run. Be willing to revisit
          harness, evaluator code, and source code.
  3. **Abort conditions:**
     - The user has set max_consecutive_failures. After that many failed runs
       in a row, stop the loop and write a final summary explaining what was
       tried.
     - The user can hit an emergency Stop button. The chat will receive an
       AbortError; if that happens, do not start a new run.

Constraints:
  - Edits to source code for observability are allowed but always note the
    perf tradeoff in the run summary.
  - The harness must be deterministic enough that metrics are comparable
    across runs (same OS, same npm cache, same commit before changes, etc.).
  - Don't \`git push\`; don't \`git remote add\`; don't fetch from origin.

Stream short, factual updates in chat as you execute (one or two short
paragraphs per run). The user reads the Runs tab for the structured view.`

const FIRST_USER_PROMPT = `Begin by:

1. Calling cocoindex_code.search a few times to get a feel for the repo
   (entry points, main subsystems, any recent experiment-flavoured branches).
2. Drafting a 4–6 bullet summary of what this codebase appears to do, naming
   the concrete files/modules you saw.
3. Asking the user: "Is that summary correct, and what's the goal you want
   to optimise here?" — then offer 3 concrete examples that fit the
   shape of a Harness goal, e.g.:
       — "Mount our FUSE client in a VM and get \`npm i -g next\` under 9s
         while keeping unit tests green."
       — "Cache hot inbox queries so /inbox p95 drops below 80 ms without
         increasing memory > 1 GB."
       — "Cut nightly Postgres autovacuum runtime by 50% without growing
         index size by more than 10%."

Do NOT call experiment_state.set_goal yet — wait for the user to confirm or
refine.`

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
  }>(
    sql`SELECT id, index_id, codex_thread_id FROM experiments WHERE id = ${experimentId} LIMIT 1`,
  )
  const exp = rawExp[0]
  if (!exp) throw new Error(`No experiment row for ${experimentId}`)

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
    : `${SYSTEM_PROMPT}${
        projectMemory
          ? `\n\n--- PROJECT MEMORY (verbatim from repo) ---\n${projectMemory}`
          : ''
      }\n\n${FIRST_USER_PROMPT}${
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

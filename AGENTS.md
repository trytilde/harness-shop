# AGENTS.md

Guide for AI agents (Codex, Claude Code, …) and humans contributing to
this repository.

## Big picture

Harness is a TanStack Start app that orchestrates Codex agents to design
and run optimisation experiments against arbitrary git repos. The
**source of truth** for any experiment lives in `data/harness.db`
(libsql). The UI never writes structured experiment data directly — it
all flows through the `experiment_state` MCP server so the same writes
work whether they originate from a human button click or an agent tool
call.

If you're an agent contributing to *this* repo (i.e. editing this
codebase), you're a normal coding agent — there is no harness loop on
yourself. Just follow the conventions below.

## Conventions

### Architecture

- **TanStack Start** (Vite SSR + file-based routes). Components are
  ordinary React; server functions and route handlers run on Node.
- **No client → DB direct calls.** Pages use server functions
  (`createServerFn`) or fetch our REST/SSE endpoints. The DB lives behind
  `src/server/db/client.ts::getDb()`.
- **Drizzle for typed queries**, raw SQL via `db.run(sql\`...\`)` where
  the relational schema would be awkward (e.g. cross-table aggregates).
- **MCP servers are the agent's only mutation surface for experiment
  state.** Don't add a server function that lets the UI bypass them — if
  you do, the agent will see drift.

### Data flow rules

- **Per-experiment row** (`experiments`) tracks `phase`
  (`design | harness | runs | completed`), `index_id`,
  `codex_thread_id`, `max_consecutive_failures`, and the JSON
  `draft_json` (goal, sub-goals, artifacts, metrics, harness).
- **Per-run row** (`experiment_runs`) is created by the agent calling
  `start_run`. Children: `run_metrics`, `run_artifacts`,
  `run_evaluator_outcomes`. The agent fills these via MCP tools.
- **Chat history** is captured in `chat_messages` (one row per
  UIMessage). The SSE route assembles assistant parts during a turn and
  flushes a single row at `finish`.

### Streaming + cancellation

- The chat endpoint follows a Vercel-AI-SDK-style **resumable stream**
  pattern. POST starts a new turn (refusing 409 if one is already in
  flight); GET attaches to the in-flight stream (replays buffered events,
  then live-tails). Closing the HTTP response **does not** abort the
  agent — only an explicit POST to `/chat/cancel` does.
- `useExperimentChat` (in `src/lib/`) handles history hydration, an
  attempt to attach to an in-flight stream on mount, and per-tool-call
  ticks for downstream consumers (the right panel and the diff tab).

### File locations

- Adding a new client component → `src/components/...`. Reuse shadcn/ui
  primitives where possible.
- Adding a new server function → `src/server/api/<name>.ts` and export
  `createServerFn(...).handler(...)`. Don't co-locate non-server-fn
  helpers in the same file (TanStack splits per-file and helpers can drag
  Node-only deps into the client bundle).
- Adding an MCP tool → extend `src/mcp-servers/experiment-state.mjs`.
  The MCP server runs in a child Node process spawned by codex; **paths
  passed to it via env must be absolute** (the child's cwd is the codex
  workspace, not the project root).

### Sandbox + git

- The agent that drives experiments runs inside codex's `workspace-write`
  sandbox. Codex's auto-approve fast path needs the trio
  `approval_policy=on-request` + `approvals_reviewer=auto_review` +
  `default_tools_approval_mode=approve` — change any of these only with a
  good reason; otherwise tools start cancelling.
- The cloned repo's `origin` is removed in `src/server/indexing/runner.ts`.
  Don't re-add it.

### Migrations

- We use plain SQL `CREATE TABLE IF NOT EXISTS` + `ensureColumn` (an
  `ALTER TABLE ADD COLUMN` runner) in `src/server/db/client.ts`. Keep the
  Drizzle schema in `src/server/db/schema.ts` in lockstep. **Never `ALTER
  TABLE DROP COLUMN`** — too risky for libsql / SQLite. Add new columns,
  ignore obsolete ones.

### Environment variables

| Var | Purpose |
|---|---|
| `HARNESS_DB_URL` | Override libsql URL. Defaults to `file:./data/harness.db`. Use `libsql://...` + `HARNESS_DB_AUTH_TOKEN` for Turso. |
| `HARNESS_DB_PATH` | Filesystem path used when `HARNESS_DB_URL` is unset. |
| `HARNESS_TOKEN_ENCRYPTION_KEY` | base64 32-byte key. Encrypts secrets at rest in `oauth_accounts` + `app_settings`. |
| `HARNESS_REPOS_DIR` | Override the clone root. Defaults to `./data/repos`. |
| `HARNESS_CODEX_HOME` | Where we materialise `auth.json` for the Codex CLI. Defaults to `./data/codex-home`. |
| `CCC_BIN` | Path to `cocoindex-code`'s `ccc` binary. Defaults to `~/.local/bin/ccc`. |
| `OPENAI_API_KEY` | Optional — used only as the embeddings fallback when the saved API key in app_settings is missing. |

### Coding standards

- TypeScript strict, `tsc --noEmit` must pass.
- Tailwind v4. shadcn/ui CSS variables for theming. IBM Plex Mono for
  code; IBM Plex Sans for prose.
- Keep server-only modules out of files imported by client. The chat
  history split (`src/server/api/chat-history.ts` / `src/server/chat/persist.ts`)
  is the canonical example of how to avoid leaking `node:fs` into the
  browser bundle.
- Avoid polling. Prefer event-driven updates (SSE, tool-completion ticks
  on the chat hook) — polling makes the page feel jumpy.

## Where to start

- **Add a new MCP tool the agent can call** → edit
  `src/mcp-servers/experiment-state.mjs` and ensure the tool is mentioned
  in the system prompt at `src/server/agent/codex-runner.ts::SYSTEM_PROMPT`.
  The agent only learns about a tool by reading the prompt + the MCP
  metadata; without the prompt nudge it usually won't call it.
- **Render new sidebar content** → extend `DraftPanel`. Don't fetch
  per-second; subscribe to `chat.toolCompletionTick` instead.
- **Add a new top-level tab on the experiment page** → add an entry to
  `TabSwitcher` in `src/routes/_app/experiments/$experimentId.tsx` and a
  matching component under `src/components/experiment/`.

## Tests

We don't have a test suite yet. The expectation is:

- Server modules → unit tests with `vitest` (already wired in
  `package.json`).
- DB-touching code → use a temporary file path and `HARNESS_DB_URL`
  override.
- UI → smoke tests via `@testing-library/react`.

## When in doubt

Look at git history (`git log --oneline`). Recent commits document a
chain of small course-corrections — each one points at a specific class
of bug we already hit (DB-locking, sandbox `.git` writes, stream
re-attach, …). Reading the message + diff is usually faster than
re-deriving the design.

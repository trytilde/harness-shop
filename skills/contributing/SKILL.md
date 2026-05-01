---
name: harness-contributing
description: >-
  Pre-flight for contributing code to this repo (Harness). Loads in any
  agent that's editing files here. Pairs with AGENTS.md but trims it down
  to the actionable "before you commit" list.
---

# Contributing to Harness

## Before you commit

- `pnpm exec tsc --noEmit` must pass.
- If you added a server function in `src/server/api/...`, check that the
  file does **not** import any helper that pulls in node-only modules
  (`node:fs`, `simple-git`, …) unless the helper is a true server-only
  side-import. Otherwise the client bundle breaks (the `chat-history.ts`
  / `chat/persist.ts` split is the canonical example).
- If you touched the DB schema, update both `src/server/db/schema.ts`
  (Drizzle) **and** the migration block in `src/server/db/client.ts`.
  Use `ensureColumn(...)` for additive migrations.
- If you added an MCP tool, add it (1) to the registration in
  `src/mcp-servers/experiment-state.mjs` and (2) to the relevant
  prompt section of `src/server/agent/codex-runner.ts`. The agent
  doesn't auto-discover tool semantics from MCP metadata alone.
- Don't add polling. Use the existing event-driven hooks
  (`chat.toolCompletionTick`, `chat.pending` flips, manual refresh
  buttons). The diff tab and the runs tab are the references.
- Never commit anything under `data/`. The `.gitignore` already covers
  `data/`, `*.db*`, `*.sqlite*`, `auth.json` — don't undo it.

## Layout cheatsheet

```
src/
  components/             # React components (shadcn/ui based)
  components/ui/          # Generated shadcn primitives — leave alone
  lib/                    # Client + shared types & hooks
  routes/                 # TanStack Router file-based routes
  routes/api/             # SSE / REST endpoints (`server.handlers`)
  server/                 # Server-only modules
    db/                   # libsql + Drizzle
    api/                  # createServerFn handlers
    agent/                # Codex SDK glue
    chat/                 # Active-stream registry
    indexing/             # Clone + cocoindex daemon
    oauth/                # GitHub + ChatGPT auth flows
  mcp-servers/            # Stdio MCP servers spawned by codex
```

## Running

```bash
make setup        # one-time: pnpm install + cocoindex-code + ripgrep
make dev          # vite dev on http://localhost:3100
make typecheck    # tsc --noEmit
make ccc-doctor   # verify cocoindex-code install
```

## Testing the agent loop end-to-end

1. `make dev`.
2. Connect GitHub + ChatGPT in Settings.
3. Create a small experiment (a 1-file repo works fine).
4. Walk through design → harness → runs phases. Every state
   transition should reflect in both the DB and the UI within 1 s of a
   tool-call completion.
5. If something feels stuck, check `data/harness.db` directly with
   `sqlite3 data/harness.db ".tables"` and the relevant SELECTs; the
   agent's `experiment_state` MCP server writes into the same DB.

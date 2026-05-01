# Harness

> Design, run, and iterate on optimisation experiments against your codebase.

Harness is a local-first workbench for turning a vague engineering goal —
*"make `npm i -g next` finish in under 9 s in our FUSE VM"* — into a
runnable, measurable, agent-driven experiment loop. It clones the target
repo, indexes it semantically, sits the Codex agent on top of the index, and
walks you (with the agent) through:

1. **Design** — agree on a one-sentence goal, 2–4 sub-goals (mix of
   quantitative + qualitative), the output artifacts each run produces,
   and the metrics worth graphing.
2. **Harness implementation** — the agent edits the cloned source to add a
   repeatable run script, the evaluator code/prompts, and any minimal
   instrumentation.
3. **Run loop** — the agent executes the harness, collects artifacts,
   metrics, and per-evaluator pass/fail; commits each run on a private
   branch (`experiment/<id>`) tagged `experiment/<id>/<runNum>`; reviews;
   adjusts; tries again. Aborts after a configurable number of consecutive
   failures.

The whole thing runs on your machine. The cloned repo's remote is removed
so the agent **cannot push**. Indexes, runs, metrics, and evaluator outcomes
all live in a single libsql / SQLite DB.

## Why this exists

Optimisation work is repetitive: write a benchmark harness, capture
artifacts, parse them, decide what to change, repeat. Each iteration's
context is brittle and almost never reused for the next iteration.

Harness:

- **Persists every run** (artifacts, metrics, evaluator outcomes) so the
  agent can search prior runs and reason over multiple iterations rather
  than guess from short-term memory.
- **Grounds the agent in your code** via [cocoindex-code](https://github.com/cocoindex-io/cocoindex-code) — semantic search over the cloned repo via an MCP server.
- **Scopes blast radius** — workspace-write sandbox + remote stripped so
  experiments stay 100 % local until you decide otherwise.

## Stack

| Layer | Choice |
|---|---|
| Web framework | [TanStack Start](https://tanstack.com/start/) (React + Vite SSR + server functions) |
| UI | shadcn/ui · Tailwind v4 · IBM Plex Sans/Mono · `react-resizable-panels` · `react-diff-viewer-continued` · `recharts` |
| Storage | SQLite via [libsql](https://github.com/tursodatabase/libsql-client-ts) + [Drizzle ORM](https://orm.drizzle.team/) |
| Agent | [`@openai/codex-sdk`](https://www.npmjs.com/package/@openai/codex-sdk) over the upstream `codex` CLI. ChatGPT Plus auth via the same OAuth flow as the codex CLI. |
| Tools | Codex agent ↔ MCP servers: `cocoindex_code` (semantic search) + a custom `experiment_state` server that owns the design/run-state writes |
| Indexing | [`cocoindex-code`](https://github.com/cocoindex-io/cocoindex-code) (per-repo SQLite index, OpenAI embeddings via your JWT or API key) |
| Diff render | `react-diff-viewer-continued` (split view) |

## Setup

```bash
git clone https://github.com/trytilde/harness-shop
cd harness-shop
make setup        # pnpm install + cocoindex-code + ripgrep
make dev          # http://localhost:3100
```

Override host/port for remote dev:

```bash
pnpm dev -- --host 0.0.0.0 --port 3000
```

### First-run wizard

1. Click the **gear** in the top-right → *Configure GitHub*. Walk through
   the OAuth-app instructions; paste client id + secret. Authorise.
2. *Configure OpenAI subscription* — sign in with ChatGPT (Plus). The auth
   token is materialised into our own `data/codex-home/auth.json` so we
   don't touch your real `~/.codex`.
3. Optionally *Configure OpenAI API key* — falls back here if the JWT is
   throttled or rejected (e.g. for the `/v1/responses` agent endpoint, the
   JWT lacks `api.responses.write` scope; an API key is the path).
4. **Create experiment** → pick repo + branch. Harness clones it, indexes
   it (cocoindex daemon, OpenAI embeddings, ~couple of minutes for a fresh
   medium-sized repo), then drops you in the chat.

## Project layout

```
src/
  components/                  # UI: top bar, dialogs, experiment shell
    experiment/
      chat-panel.tsx           # Markdown chat + tool-call cards
      draft-panel.tsx          # Right sidebar: goal, sub-goals, …
      runs-tab.tsx             # Runs table + recharts metric graphs
      diffs-tab.tsx            # Full-page side-by-side diffs
  lib/                         # Shared types, client hooks
    use-experiment-chat.ts     # SSE streaming + history replay + cancel
  routes/_app/                 # TanStack Router file-based routes
    experiments/$experimentId.tsx
  routes/api/                  # SSE + REST server routes
    experiments.$experimentId.chat.ts
    experiments.$experimentId.chat.cancel.ts
    index-stream.$jobId.ts
  server/
    db/                        # libsql + Drizzle schema + migrations
    api/                       # Server functions (queryable from the client)
    agent/codex-runner.ts      # Codex SDK orchestration + system prompt
    chat/                      # Active-stream registry + persistence
    indexing/                  # simple-git clone, cocoindex daemon glue
    oauth/                     # GitHub OAuth App + ChatGPT PKCE
  mcp-servers/
    experiment-state.mjs       # Stdio MCP server — agent's writes to draft + runs
```

## Architecture cheat-sheet

```
┌─────────── Browser ───────────┐
│  TanStack Router + React      │
│  - useExperimentChat (SSE)    │
│  - DraftPanel · RunsTab        │
└───────────┬───────────────────┘
            │ SSE / fetch
┌───────────▼─── TanStack Start (Vite SSR) ─────────────┐
│  /api/experiments/$id/chat   POST = start a turn      │
│                              GET  = attach to live    │
│  /api/experiments/$id/chat/cancel  POST = abort       │
│  Server functions (Drizzle ⇆ libsql)                  │
│  Codex runner: spawns codex exec with                 │
│   - mcp_servers.cocoindex_code (ccc mcp, cwd=clone)   │
│   - mcp_servers.experiment_state (Node, our DB)       │
└───────────┬───────────────────┬───────────────────────┘
            │                   │
            │ stdio MCP         │ stdio MCP
            │                   │
   ┌────────▼─────────┐   ┌─────▼──────────┐
   │  cocoindex-code  │   │ experiment_    │
   │  (semantic       │   │ state.mjs       │
   │   search,        │   │ (writes goal,   │
   │   per-repo       │   │  sub-goals,     │
   │   SQLite index)  │   │  artifacts,     │
   └──────────────────┘   │  metrics, runs) │
                          └─────────────────┘
                          Same data/harness.db as the app.
```

The Codex agent is the only thing writing structured experiment state —
the UI only reads. That keeps state derivation in one place.

## Privacy & safety defaults

- The clone path is `data/repos/<org>/<name>/<sha>/`. Its `origin` remote
  is **removed** immediately after clone. Codex's sandbox is set to
  `workspace-write` with `.git` explicitly added to the writable roots so
  the agent can branch, commit, and tag locally — but no `git push` is
  possible without a remote.
- Tokens (GitHub OAuth, ChatGPT JWT, OpenAI API key) are encrypted with
  AES-256-GCM keyed off `HARNESS_TOKEN_ENCRYPTION_KEY` (override via
  `.env.local`; a deterministic dev fallback is used otherwise).
- Nothing under `data/` is git-tracked. Check `.gitignore` if you're not
  sure.

## Contributing

Harness is built to be extensible. We expect to add other "shops"
(other harness flavours) over time — performance regressions, security
review, dependency upgrades — under this same monorepo. See
[`AGENTS.md`](./AGENTS.md) for the agent/contributor guide and
[`skills/`](./skills) for reusable agent skills shipped with the project.

## License

Apache-2.0.

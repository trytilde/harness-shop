import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'

import * as schema from './schema'

declare global {
  // Survives Vite HMR restarts so we don't reopen the DB twice.
  // eslint-disable-next-line no-var
  var __harnessDb: ReturnType<typeof drizzle<typeof schema>> | undefined
  // eslint-disable-next-line no-var
  var __harnessDbClient: Client | undefined
}

function dbUrl(): string {
  const explicit = process.env.HARNESS_DB_URL ?? process.env.LIBSQL_URL
  if (explicit) return explicit
  const path = process.env.HARNESS_DB_PATH ?? './data/harness.db'
  const abs = isAbsolute(path) ? path : resolve(process.cwd(), path)
  mkdirSync(dirname(abs), { recursive: true })
  return `file:${abs}`
}

function authToken(): string | undefined {
  return process.env.HARNESS_DB_AUTH_TOKEN ?? process.env.LIBSQL_AUTH_TOKEN
}

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS oauth_providers (
    id TEXT PRIMARY KEY NOT NULL,
    client_id TEXT,
    client_secret_enc TEXT,
    callback_url TEXT NOT NULL,
    callback_port INTEGER NOT NULL,
    configured_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS oauth_accounts (
    id TEXT PRIMARY KEY NOT NULL,
    access_token_enc TEXT NOT NULL,
    refresh_token_enc TEXT,
    id_token_enc TEXT,
    token_type TEXT,
    scope TEXT,
    expires_at INTEGER,
    account_id TEXT,
    account_login TEXT,
    account_avatar_url TEXT,
    raw_json TEXT,
    connected_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY NOT NULL,
    experiment_id TEXT NOT NULL,
    role TEXT NOT NULL,
    parts_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS chat_messages_exp_idx
    ON chat_messages(experiment_id, created_at);

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT,
    encrypted INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS ccc_processes (
    pid INTEGER PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    index_id TEXT,
    job_id TEXT,
    started_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS indexed_codebases (
    id TEXT PRIMARY KEY NOT NULL,
    repo_org TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    ref_value TEXT,
    clone_path TEXT NOT NULL,
    status TEXT NOT NULL,
    files_count INTEGER,
    chunks_count INTEGER,
    language_breakdown TEXT,
    error_message TEXT,
    started_at INTEGER NOT NULL DEFAULT (unixepoch()),
    completed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS experiments (
    id TEXT PRIMARY KEY NOT NULL,
    repo_org TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    ref_kind TEXT NOT NULL,
    ref_value TEXT NOT NULL,
    ref_commit TEXT,
    index_id TEXT,
    codex_thread_id TEXT,
    title TEXT,
    goal TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    draft_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Idempotent column additions for upgrades from earlier schema:
  -- ALTER ADD COLUMN with IF NOT EXISTS isn't supported; PRAGMA-based migrations
  -- would be cleaner, but for a single-user dev tool we'll just recreate via
  -- CREATE IF NOT EXISTS on fresh DBs. If you've got an old DB without these
  -- columns, run \`make clean\` then \`make setup\`.

  CREATE TABLE IF NOT EXISTS experiment_runs (
    id TEXT PRIMARY KEY NOT NULL,
    experiment_id TEXT NOT NULL,
    run_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    title TEXT,
    summary TEXT,
    branch TEXT,
    base_commit_sha TEXT,
    commit_sha TEXT,
    tag TEXT,
    error_message TEXT,
    started_at INTEGER NOT NULL DEFAULT (unixepoch()),
    completed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS experiment_runs_exp_idx
    ON experiment_runs(experiment_id, run_number);

  CREATE TABLE IF NOT EXISTS run_metrics (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL,
    metric_id TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    value TEXT NOT NULL,
    passed INTEGER,
    unit TEXT,
    measured_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS run_metrics_run_idx ON run_metrics(run_id);

  CREATE TABLE IF NOT EXISTS run_artifacts (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT,
    content_preview TEXT,
    byte_size INTEGER,
    captured_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS run_artifacts_run_idx ON run_artifacts(run_id);

  CREATE TABLE IF NOT EXISTS run_evaluator_outcomes (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL,
    subgoal_id TEXT NOT NULL,
    passed INTEGER NOT NULL,
    output TEXT,
    error_message TEXT,
    evaluated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS run_evaluator_outcomes_run_idx
    ON run_evaluator_outcomes(run_id);
`

let migrationsApplied = false

async function applyMigrations(client: Client) {
  if (migrationsApplied) return
  await client.executeMultiple(MIGRATION_SQL)
  // Backfill columns that older DBs may be missing.
  await ensureColumn(client, 'experiments', 'index_id', 'TEXT')
  await ensureColumn(client, 'experiments', 'codex_thread_id', 'TEXT')
  await ensureColumn(
    client,
    'experiments',
    'phase',
    "TEXT NOT NULL DEFAULT 'design'",
  )
  await ensureColumn(
    client,
    'experiments',
    'max_consecutive_failures',
    'INTEGER',
  )
  migrationsApplied = true
}

async function ensureColumn(
  client: Client,
  table: string,
  column: string,
  type: string,
) {
  const info = await client.execute(`PRAGMA table_info(${table})`)
  const has = info.rows.some((r) => String(r.name) === column)
  if (!has) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}

function init() {
  const client = createClient({ url: dbUrl(), authToken: authToken() })
  // Make concurrent access safe:
  //   - WAL: many readers + one writer concurrently.
  //   - busy_timeout: writers wait up to 10 s for the WAL lock instead of
  //     immediately failing with SQLITE_BUSY (which surfaces as HTTP 500
  //     from server fns when the experiment_state MCP child writes at the
  //     same time as the main app).
  void client.executeMultiple(
    `PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;`,
  )
  // Fire and forget — libsql runs each statement on its own connection so a
  // concurrent migration call is safe. We also await it lazily on first use.
  void applyMigrations(client)
  return { client, db: drizzle(client, { schema }) }
}

export async function getDb() {
  if (!globalThis.__harnessDb || !globalThis.__harnessDbClient) {
    const { client, db } = init()
    globalThis.__harnessDb = db
    globalThis.__harnessDbClient = client
  }
  await applyMigrations(globalThis.__harnessDbClient!)
  return globalThis.__harnessDb
}

export { schema }

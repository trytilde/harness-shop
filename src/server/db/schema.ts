import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Per-provider OAuth client config (the bits the user pastes into the setup
 * modal). One row per provider id. Encrypted secrets, plaintext IDs.
 */
export const oauthProviders = sqliteTable('oauth_providers', {
  id: text('id').primaryKey(), // 'github' | 'codex'
  clientId: text('client_id'),
  clientSecretEnc: text('client_secret_enc'),
  callbackUrl: text('callback_url').notNull(),
  callbackPort: integer('callback_port').notNull(),
  configuredAt: integer('configured_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

/**
 * Live OAuth tokens after a successful sign-in. One row per provider id;
 * disconnect = delete the row.
 */
export const oauthAccounts = sqliteTable('oauth_accounts', {
  id: text('id').primaryKey(), // 'github' | 'codex'
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc'),
  idTokenEnc: text('id_token_enc'),
  tokenType: text('token_type'),
  scope: text('scope'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  accountId: text('account_id'),
  accountLogin: text('account_login'),
  accountAvatarUrl: text('account_avatar_url'),
  rawJson: text('raw_json'),
  connectedAt: integer('connected_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

/**
 * Experiments. Body fields are nullable until each wizard stage commits.
 */
export const experiments = sqliteTable('experiments', {
  id: text('id').primaryKey(),
  repoOrg: text('repo_org').notNull(),
  repoName: text('repo_name').notNull(),
  refKind: text('ref_kind', { enum: ['branch', 'commit', 'pr'] }).notNull(),
  refValue: text('ref_value').notNull(),
  refCommit: text('ref_commit'),
  /** FK-style reference to indexed_codebases.id (`<org>/<name>@<sha>`). */
  indexId: text('index_id'),
  /** Codex thread id so we can resume across reloads. */
  codexThreadId: text('codex_thread_id'),
  /** Harness workflow type. */
  harnessId: text('harness_id').notNull().default('experiment'),
  providerName: text('provider_name'),
  toolsCsv: text('tools_csv'),
  title: text('title'),
  goal: text('goal'),
  status: text('status', {
    enum: ['draft', 'running', 'finished', 'failed', 'requires_input'],
  })
    .notNull()
    .default('draft'),
  /** UX phase — drives the bottom-button progression. */
  phase: text('phase', {
    enum: ['design', 'harness', 'runs', 'completed'],
  })
    .notNull()
    .default('design'),
  /** Hard cap on consecutive failed runs before the run loop aborts. */
  maxConsecutiveFailures: integer('max_consecutive_failures'),
  draftJson: text('draft_json'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

/**
 * One row per (org, name, commit_sha). Index reuse across experiments — if a
 * second experiment requests the same sha and the row is `ready`, we skip
 * cloning + indexing entirely.
 */
export const indexedCodebases = sqliteTable('indexed_codebases', {
  id: text('id').primaryKey(), // "<org>/<name>@<sha>"
  repoOrg: text('repo_org').notNull(),
  repoName: text('repo_name').notNull(),
  commitSha: text('commit_sha').notNull(),
  refValue: text('ref_value'),
  clonePath: text('clone_path').notNull(),
  status: text('status', {
    enum: ['cloning', 'indexing', 'ready', 'failed'],
  }).notNull(),
  filesCount: integer('files_count'),
  chunksCount: integer('chunks_count'),
  languageBreakdown: text('language_breakdown'),
  errorMessage: text('error_message'),
  startedAt: integer('started_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
})

/**
 * PIDs of ccc child processes we've spawned. We record on spawn and remove on
 * close — and on server start we kill any leftovers before clearing the table.
 * Survives a Vite dev restart that otherwise leaves orphaned `ccc index`
 * processes holding the daemon's indexing lock.
 */
export const cccProcesses = sqliteTable('ccc_processes', {
  pid: integer('pid').primaryKey(),
  kind: text('kind').notNull(), // 'index' | 'init' | etc.
  indexId: text('index_id'),
  jobId: text('job_id'),
  startedAt: integer('started_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

/**
 * Generic key/value store for app-wide settings (e.g. encrypted OpenAI API
 * key, embedding model preference). Avoids stuffing unrelated config into the
 * provider-specific tables.
 */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  encrypted: integer('encrypted').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

/**
 * One row per persisted chat message in an experiment thread. Each row
 * captures a UIMessage (user or assistant), with parts (text + tool calls)
 * serialized in `parts_json`. The home page list view doesn't read this —
 * only the experiment chat replay does.
 */
export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  experimentId: text('experiment_id').notNull(),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  partsJson: text('parts_json').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

/** Per-run record (one row per execution of the harness). */
export const experimentRuns = sqliteTable('experiment_runs', {
  id: text('id').primaryKey(),
  experimentId: text('experiment_id').notNull(),
  runNumber: integer('run_number').notNull(),
  status: text('status', {
    enum: ['pending', 'running', 'passed', 'failed', 'cancelled'],
  })
    .notNull()
    .default('pending'),
  title: text('title'),
  summary: text('summary'),
  branch: text('branch'),
  baseCommitSha: text('base_commit_sha'),
  commitSha: text('commit_sha'),
  tag: text('tag'),
  errorMessage: text('error_message'),
  startedAt: integer('started_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
})

/** One row per (run, metric) sample. */
export const runMetrics = sqliteTable('run_metrics', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  metricId: text('metric_id').notNull(),
  metricName: text('metric_name').notNull(),
  value: text('value').notNull(), // stored as text to allow numbers/strings
  passed: integer('passed', { mode: 'boolean' }),
  unit: text('unit'),
  measuredAt: integer('measured_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

/** One row per artifact captured during a run. */
export const runArtifacts = sqliteTable('run_artifacts', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  artifactId: text('artifact_id').notNull(),
  name: text('name').notNull(),
  path: text('path'),
  contentPreview: text('content_preview'), // first ~16 KB
  byteSize: integer('byte_size'),
  capturedAt: integer('captured_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

/** Sub-goal evaluator outcomes per run. */
export const runEvaluatorOutcomes = sqliteTable('run_evaluator_outcomes', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  subgoalId: text('subgoal_id').notNull(),
  passed: integer('passed', { mode: 'boolean' }).notNull(),
  output: text('output'),
  errorMessage: text('error_message'),
  evaluatedAt: integer('evaluated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type DbExperimentRun = typeof experimentRuns.$inferSelect
export type DbRunMetric = typeof runMetrics.$inferSelect
export type DbRunArtifact = typeof runArtifacts.$inferSelect
export type DbRunEvaluatorOutcome = typeof runEvaluatorOutcomes.$inferSelect

export type DbOauthProvider = typeof oauthProviders.$inferSelect
export type DbOauthAccount = typeof oauthAccounts.$inferSelect
export type DbExperiment = typeof experiments.$inferSelect
export type DbIndexedCodebase = typeof indexedCodebases.$inferSelect
export type DbCccProcess = typeof cccProcesses.$inferSelect

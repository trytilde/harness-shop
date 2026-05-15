#!/usr/bin/env node
// experiment_state MCP server — drives the right-side draft panel.
//
// Spawned by the Codex agent (configured in mcp_servers). Each tool call
// updates `experiments.draft_json` for HARNESS_EXPERIMENT_ID directly via
// libsql so the UI's polling/subscription picks the change up.
//
// stdio MCP server, single tenant per experiment_id (passed via env).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

import { createClient } from '@libsql/client'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import YAML from 'yaml'

const EXPERIMENT_ID = process.env.HARNESS_EXPERIMENT_ID
if (!EXPERIMENT_ID) {
  console.error('experiment-state MCP: HARNESS_EXPERIMENT_ID env var is required')
  process.exit(1)
}

function dbUrl() {
  const explicit = process.env.HARNESS_DB_URL ?? process.env.LIBSQL_URL
  if (explicit) return explicit
  const path = process.env.HARNESS_DB_PATH ?? './data/harness.db'
  const abs = isAbsolute(path) ? path : resolve(process.cwd(), path)
  mkdirSync(dirname(abs), { recursive: true })
  return `file:${abs}`
}

const client = createClient({
  url: dbUrl(),
  authToken: process.env.HARNESS_DB_AUTH_TOKEN ?? process.env.LIBSQL_AUTH_TOKEN,
})

// Same locking pragmas the main app uses — without these, two writers (the
// app and this MCP child) collide on the WAL and the loser sees SQLITE_BUSY.
await client.executeMultiple(
  'PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;',
)

/** Loads the current draft for this experiment (creates an empty one if missing). */
async function loadDraft() {
  const row = await client.execute({
    sql: 'SELECT draft_json FROM experiments WHERE id = ?',
    args: [EXPERIMENT_ID],
  })
  if (row.rows.length === 0) {
    throw new Error(`No experiment row for id=${EXPERIMENT_ID}`)
  }
  const raw = row.rows[0].draft_json
  if (!raw) return emptyDraft()
  try {
    return { ...emptyDraft(), ...JSON.parse(String(raw)) }
  } catch {
    return emptyDraft()
  }
}

function emptyDraft() {
  return {
    goal: '',
    providerHarness: undefined,
    infoBlocks: [],
    requiredSecrets: [],
    subGoals: [],
    artifacts: [],
    metrics: [],
    overrideSecretsForm: undefined,
    harness: { description: '', code: undefined },
  }
}

function metadataPath(providerId) {
  const clonePath = process.env.HARNESS_CLONE_PATH
  if (!clonePath) throw new Error('HARNESS_CLONE_PATH is required')
  return join(clonePath, 'providers', providerId, 'generator-metadata.yaml')
}

function loadGeneratorMetadata(providerId) {
  const path = metadataPath(providerId)
  if (!existsSync(path)) return {}
  try {
    return YAML.parse(readFileSync(path, 'utf8')) ?? {}
  } catch {
    return {}
  }
}

function saveGeneratorMetadata(providerId, patch) {
  const path = metadataPath(providerId)
  mkdirSync(dirname(path), { recursive: true })
  const next = { ...loadGeneratorMetadata(providerId), ...patch }
  writeFileSync(path, YAML.stringify(next), { mode: 0o644 })
}

function upsertProviderHarness(draft, patch) {
  draft.providerHarness = {
    phase: 'discovery',
    references: [],
    discoveryNotes: [],
    toolGoals: {},
    toolPlans: [],
    e2eTests: [],
    implementationNotes: [],
    ...(draft.providerHarness ?? {}),
    ...patch,
  }
}

async function saveDraft(draft) {
  await client.execute({
    sql:
      'UPDATE experiments SET draft_json = ?, updated_at = unixepoch() WHERE id = ?',
    args: [JSON.stringify(draft), EXPERIMENT_ID],
  })
}

function ok(text, structured) {
  return {
    content: [{ type: 'text', text }],
    structuredContent: structured,
  }
}

function fail(message) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  }
}

const server = new McpServer(
  { name: 'experiment_state', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

async function renderOverrideSecretsForm({ provider_id, json_schema, file }) {
  const draft = await loadDraft()
  draft.overrideSecretsForm = {
    providerId: provider_id,
    file,
    schema: json_schema,
  }
  if (json_schema?.properties && typeof json_schema.properties === 'object') {
    const required = Array.isArray(json_schema.required)
      ? new Set(json_schema.required)
      : new Set()
    draft.requiredSecrets = Object.entries(json_schema.properties).map(
      ([name, schema]) => ({
        name,
        description:
          schema && typeof schema === 'object' && 'description' in schema
            ? String(schema.description ?? name)
            : name,
        required: required.has(name),
      }),
    )
  }
  await saveDraft(draft)
  return ok(`Override secrets form rendered.`, {
    provider_id,
    file,
    json_schema,
  })
}

// ---------- Title ----------

server.registerTool(
  'set_title',
  {
    title: 'Set experiment title',
    description:
      'Set or update the short experiment title shown in the home dashboard. ~3–8 words, action-oriented.',
    inputSchema: {
      title: z.string().min(3).max(120).describe('The experiment title.'),
    },
  },
  async ({ title }) => {
    const trimmed = title.trim()
    // Persist the title to both the dedicated column AND the draft so the
    // home table picks it up regardless of read path.
    const draft = await loadDraft()
    draft.title = trimmed
    await saveDraft(draft)
    await client.execute({
      sql:
        'UPDATE experiments SET title = ?, updated_at = unixepoch() WHERE id = ?',
      args: [trimmed, EXPERIMENT_ID],
    })
    return ok(`Title set.`, { title: trimmed })
  },
)

// ---------- Harness information blocks ----------

server.registerTool(
  'upsert_info_block',
  {
    title: 'Create or update a sidebar information block',
    description:
      'Persist structured discovery or spec information for the sidebar. Use this for provider facts, auth model, proposed tools, docs/examples findings, e2e questions, e2e specs, and provider/tool specs.',
    inputSchema: {
      id: z.string().min(1),
      title: z.string().min(2),
      items: z.array(
        z.object({
          label: z.string().min(1),
          value: z.string().min(1),
        }),
      ),
    },
  },
  async ({ id, title, items }) => {
    const draft = await loadDraft()
    if (!Array.isArray(draft.infoBlocks)) draft.infoBlocks = []
    const next = {
      id,
      title: title.trim(),
      items: items.map((item) => ({
        label: item.label.trim(),
        value: item.value.trim(),
      })),
    }
    const idx = draft.infoBlocks.findIndex((block) => block.id === id)
    if (idx >= 0) draft.infoBlocks[idx] = next
    else draft.infoBlocks.push(next)
    await saveDraft(draft)
    return ok(`Info block saved: ${id}`, { id })
  },
)

server.registerTool(
  'render_secret_form',
  {
    title: 'Render override secrets form',
    description:
      'Render an inline chat form and Secrets tab form from a JSON schema. The save button writes the selected override secrets YAML file and resumes the agent.',
    inputSchema: {
      provider_id: z.string().min(1),
      json_schema: z.record(z.string(), z.unknown()),
      file: z
        .enum([
          'override_test_secrets.yaml',
          'override_secrets.yaml',
          'test_secrets.yaml',
        ])
        .default('override_test_secrets.yaml'),
    },
  },
  renderOverrideSecretsForm,
)

server.registerTool(
  'render_override_secrets_form',
  {
    title: 'Render override secrets form',
    description:
      'Persist the JSON schema used by the UI Secrets tab to render override secrets fields. Use this after the user confirms the provider e2e secret shape. The user can save the form, which writes the override secrets YAML file and resumes the agent.',
    inputSchema: {
      provider_id: z.string().min(1),
      json_schema: z.record(z.string(), z.unknown()),
      file: z
        .enum([
          'override_test_secrets.yaml',
          'override_secrets.yaml',
          'test_secrets.yaml',
        ])
        .default('override_test_secrets.yaml'),
    },
  },
  renderOverrideSecretsForm,
)

server.registerTool(
  'set_required_secrets',
  {
    title: 'Set provider e2e secret fields',
    description:
      'Declare the secret fields the UI should collect before writing provider test_secrets.yaml or override_test_secrets.yaml.',
    inputSchema: {
      secrets: z.array(
        z.object({
          name: z.string().min(1),
          description: z.string().min(1),
          required: z.boolean().default(true),
        }),
      ),
    },
  },
  async ({ secrets }) => {
    const draft = await loadDraft()
    draft.requiredSecrets = secrets.map((secret) => ({
      name: secret.name.trim(),
      description: secret.description.trim(),
      required: secret.required ?? true,
    }))
    await saveDraft(draft)
    return ok(`Required secrets updated.`, {
      requiredSecrets: draft.requiredSecrets,
    })
  },
)

// ---------- Factory CLI provider harness state ----------

const referenceSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  kind: z.enum(['auth', 'api_usage', 'general']),
  source: z.enum(['user', 'external']),
  summary: z.string().optional(),
  confirmed: z.boolean().default(false),
})

server.registerTool(
  'update_provider_discovery',
  {
    title: 'Update Factory CLI provider discovery artifacts',
    description:
      'Persist discovery phase artifacts to the sidebar and providers/<provider>/generator-metadata.yaml. Use after user confirms references and goals.',
    inputSchema: {
      provider_id: z.string().min(1),
      provider_goal: z.string().min(8),
      tool_goals: z.record(z.string(), z.string()),
      references: z.array(referenceSchema),
      discovery_notes: z.array(z.string()).default([]),
      title: z
        .string()
        .min(3)
        .max(120)
        .optional()
        .describe('Optional dashboard title for this provider harness run.'),
    },
  },
  async ({
    provider_id,
    provider_goal,
    tool_goals,
    references,
    discovery_notes,
    title,
  }) => {
    const draft = await loadDraft()
    const runTitle = title?.trim() || `Factory provider: ${provider_id}`
    draft.title = runTitle
    upsertProviderHarness(draft, {
      phase: 'discovery',
      providerId: provider_id,
      providerGoal: provider_goal,
      toolGoals: tool_goals,
      references,
      discoveryNotes: discovery_notes,
    })
    await saveDraft(draft)
    await client.execute({
      sql:
        'UPDATE experiments SET title = ?, provider_name = ?, tools_csv = ?, updated_at = unixepoch() WHERE id = ?',
      args: [
        runTitle,
        provider_id,
        Object.keys(tool_goals).join(', '),
        EXPERIMENT_ID,
      ],
    })
    saveGeneratorMetadata(provider_id, {
      discovery: {
        provider_goal,
        tool_goals,
        references,
        discovery_notes,
      },
    })
    return ok(`Provider discovery updated.`, { provider_id })
  },
)

server.registerTool(
  'update_provider_plan',
  {
    title: 'Update Factory CLI provider implementation plan',
    description:
      'Persist the provider pseudo-code/implementation plan and optional tool plans to sidebar and generator-metadata.yaml.',
    inputSchema: {
      provider_id: z.string().min(1),
      provider_plan: z.string().min(20),
      tool_plans: z
        .array(
          z.object({
            toolId: z.string().min(1),
            goal: z.string().min(4),
            implementation: z.string().optional(),
            inputSchema: z.string().optional(),
            outputSchema: z.string().optional(),
          }),
        )
        .default([]),
    },
  },
  async ({ provider_id, provider_plan, tool_plans }) => {
    const draft = await loadDraft()
    upsertProviderHarness(draft, {
      phase: 'plan',
      providerId: provider_id,
      providerPlan: provider_plan,
      toolPlans: tool_plans,
    })
    await saveDraft(draft)
    saveGeneratorMetadata(provider_id, {
      plan: {
        provider_plan,
        tool_plans,
      },
    })
    return ok(`Provider plan updated.`, { provider_id })
  },
)

server.registerTool(
  'update_provider_testing',
  {
    title: 'Update Factory CLI provider testing plan',
    description:
      'Persist e2e test specs, testing plan, and override_test_secrets.yaml shape to sidebar and generator-metadata.yaml.',
    inputSchema: {
      provider_id: z.string().min(1),
      testing_plan: z.string().min(10),
      e2e_tests: z.array(
        z.object({
          id: z.string().min(1),
          description: z.string().min(8),
          command: z.string().min(1),
          mode: z.enum(['dry_run', 'real_account']),
          assertions: z.array(z.string()).default([]),
          cleanup: z.string().optional(),
          destructive_risk: z.enum(['none', 'low', 'medium', 'high']),
        }),
      ),
      secrets_shape: z.record(z.string(), z.string()).default({}),
    },
  },
  async ({ provider_id, testing_plan, e2e_tests, secrets_shape }) => {
    const draft = await loadDraft()
    upsertProviderHarness(draft, {
      phase: 'testing',
      providerId: provider_id,
      testingPlan: testing_plan,
      e2eTests: e2e_tests.map((test) => ({
        id: test.id,
        description: test.description,
        command: test.command,
        mode: test.mode,
        assertions: test.assertions,
        cleanup: test.cleanup,
        destructiveRisk: test.destructive_risk,
      })),
      e2eSecretsShape: secrets_shape,
    })
    draft.requiredSecrets = Object.entries(secrets_shape).map(
      ([name, description]) => ({ name, description, required: true }),
    )
    await saveDraft(draft)
    saveGeneratorMetadata(provider_id, {
      testing: {
        testing_plan,
        e2e_tests,
        override_test_secrets_shape: secrets_shape,
      },
    })
    return ok(`Provider testing plan updated.`, { provider_id })
  },
)

server.registerTool(
  'update_provider_implementation',
  {
    title: 'Update Factory CLI provider implementation notes',
    description:
      'Persist implementation phase status, iteration learnings, failure summaries, and next actions to sidebar and generator-metadata.yaml.',
    inputSchema: {
      provider_id: z.string().min(1),
      notes: z.array(z.string()).default([]),
      last_failure: z.string().optional(),
      next_action: z.string().optional(),
    },
  },
  async ({ provider_id, notes, last_failure, next_action }) => {
    const draft = await loadDraft()
    upsertProviderHarness(draft, {
      phase: 'implementation',
      providerId: provider_id,
      implementationNotes: notes,
      lastFailure,
      nextAction,
    })
    await saveDraft(draft)
    saveGeneratorMetadata(provider_id, {
      implementation: {
        notes,
        last_failure,
        next_action,
      },
    })
    return ok(`Provider implementation notes updated.`, { provider_id })
  },
)

// ---------- Goal ----------

server.registerTool(
  'set_goal',
  {
    title: 'Set experiment goal',
    description:
      'Replace the experiment goal with a single concise sentence agreed with the user. There is no "save draft" button — call this immediately once the user confirms.',
    inputSchema: {
      goal: z.string().min(8).describe('The goal sentence.'),
    },
  },
  async ({ goal }) => {
    const trimmed = goal.trim()
    const draft = await loadDraft()
    draft.goal = trimmed
    await saveDraft(draft)
    // Mirror to the dedicated column so the home table & list views show it.
    await client.execute({
      sql:
        'UPDATE experiments SET goal = ?, updated_at = unixepoch() WHERE id = ?',
      args: [trimmed, EXPERIMENT_ID],
    })
    return ok(`Goal set.`, { goal: trimmed })
  },
)

// ---------- Sub-goals ----------

server.registerTool(
  'add_subgoal',
  {
    title: 'Add a sub-goal',
    description:
      'Add a measurable sub-goal. Quantitative ones must reference output_artifact ids; qualitative ones describe a reviewer prompt criterion.',
    inputSchema: {
      kind: z.enum(['quantitative', 'qualitative']),
      title: z.string().min(3),
      description: z.string().min(8),
      artifact_deps: z.array(z.string()).default([]),
      evaluator: z
        .string()
        .optional()
        .describe(
          'Quantitative: assertion code (TS/JS). Qualitative: reviewer prompt.',
        ),
    },
  },
  async ({ kind, title, description, artifact_deps, evaluator }) => {
    const draft = await loadDraft()
    const id = `sg_${randomUUID().slice(0, 8)}`
    draft.subGoals.push({
      id,
      kind,
      title: title.trim(),
      description: description.trim(),
      artifactDeps: artifact_deps,
      evaluator,
    })
    await saveDraft(draft)
    return ok(`Sub-goal added: ${id}`, { id })
  },
)

server.registerTool(
  'remove_subgoal',
  {
    title: 'Remove a sub-goal',
    description: 'Remove a sub-goal by id.',
    inputSchema: { id: z.string().min(1) },
  },
  async ({ id }) => {
    const draft = await loadDraft()
    const before = draft.subGoals.length
    draft.subGoals = draft.subGoals.filter((sg) => sg.id !== id)
    if (draft.subGoals.length === before) return fail(`No sub-goal with id ${id}`)
    await saveDraft(draft)
    return ok(`Removed ${id}`, { id })
  },
)

server.registerTool(
  'set_subgoal_evaluator',
  {
    title: 'Set the evaluator for a sub-goal',
    description:
      'Quantitative: assertion code (TS). Qualitative: reviewer prompt that consumes one or more artifacts.',
    inputSchema: {
      id: z.string().min(1),
      evaluator: z.string().min(4),
    },
  },
  async ({ id, evaluator }) => {
    const draft = await loadDraft()
    const sg = draft.subGoals.find((s) => s.id === id)
    if (!sg) return fail(`No sub-goal with id ${id}`)
    sg.evaluator = evaluator
    await saveDraft(draft)
    return ok(`Evaluator updated for ${id}`, { id })
  },
)

// ---------- Output artifacts ----------

server.registerTool(
  'add_output_artifact',
  {
    title: 'Add an output artifact',
    description:
      'Register a file or value the harness produces each run, used to evaluate sub-goals.',
    inputSchema: {
      name: z
        .string()
        .min(1)
        .describe('Stable identifier name (e.g. "install.log", "timing.json").'),
      description: z.string().min(8),
      path: z.string().optional().describe('Suggested artifact path.'),
    },
  },
  async ({ name, description, path }) => {
    const draft = await loadDraft()
    const id = `art_${randomUUID().slice(0, 8)}`
    draft.artifacts.push({
      id,
      name: name.trim(),
      description: description.trim(),
      path,
    })
    await saveDraft(draft)
    return ok(`Artifact added: ${id}`, { id })
  },
)

server.registerTool(
  'remove_output_artifact',
  {
    title: 'Remove an output artifact',
    description: 'Remove an artifact by id.',
    inputSchema: { id: z.string().min(1) },
  },
  async ({ id }) => {
    const draft = await loadDraft()
    const before = draft.artifacts.length
    draft.artifacts = draft.artifacts.filter((a) => a.id !== id)
    if (draft.artifacts.length === before)
      return fail(`No artifact with id ${id}`)
    // Drop dangling references from sub-goals.
    for (const sg of draft.subGoals) {
      sg.artifactDeps = sg.artifactDeps.filter((dep) => dep !== id)
    }
    await saveDraft(draft)
    return ok(`Removed ${id}`, { id })
  },
)

// ---------- Metrics ----------

server.registerTool(
  'add_metric',
  {
    title: 'Add a quantitative metric',
    description:
      'Register a measurable value the harness emits each run (e.g. "install_wall_ms"). Per-run values land in run_metrics; a line-graph for the metric appears on the Runs tab.',
    inputSchema: {
      name: z.string().min(1),
      description: z.string().min(4),
      unit: z.string().optional(),
      target: z
        .string()
        .optional()
        .describe('Optional comparison string, e.g. "<= 9000".'),
    },
  },
  async ({ name, description, unit, target }) => {
    const draft = await loadDraft()
    if (!Array.isArray(draft.metrics)) draft.metrics = []
    const id = `met_${randomUUID().slice(0, 8)}`
    draft.metrics.push({
      id,
      name: name.trim(),
      description: description.trim(),
      unit,
      target,
    })
    await saveDraft(draft)
    return ok(`Metric added: ${id}`, { id })
  },
)

server.registerTool(
  'remove_metric',
  {
    title: 'Remove a metric',
    description: 'Remove a metric definition by id.',
    inputSchema: { id: z.string().min(1) },
  },
  async ({ id }) => {
    const draft = await loadDraft()
    if (!Array.isArray(draft.metrics)) draft.metrics = []
    const before = draft.metrics.length
    draft.metrics = draft.metrics.filter((m) => m.id !== id)
    if (draft.metrics.length === before) return fail(`No metric with id ${id}`)
    await saveDraft(draft)
    return ok(`Removed ${id}`, { id })
  },
)

// ---------- Run config ----------

server.registerTool(
  'set_max_consecutive_failures',
  {
    title: 'Set the abort threshold for consecutive failed runs',
    description:
      'After this many consecutive failed runs, the run loop aborts. Required before runs can start.',
    inputSchema: { value: z.number().int().min(1).max(50) },
  },
  async ({ value }) => {
    await client.execute({
      sql:
        'UPDATE experiments SET max_consecutive_failures = ?, updated_at = unixepoch() WHERE id = ?',
      args: [value, EXPERIMENT_ID],
    })
    return ok(`max_consecutive_failures = ${value}`, {
      max_consecutive_failures: value,
    })
  },
)

// ---------- Phase ----------

server.registerTool(
  'set_phase',
  {
    title: "Update the experiment's UX phase",
    description:
      'Phase drives the bottom-button progression. design = chatting, harness = harness implementation, runs = executing runs, completed = done.',
    inputSchema: {
      phase: z.enum(['design', 'harness', 'runs', 'completed']),
    },
  },
  async ({ phase }) => {
    await client.execute({
      sql:
        'UPDATE experiments SET phase = ?, updated_at = unixepoch() WHERE id = ?',
      args: [phase, EXPERIMENT_ID],
    })
    return ok(`Phase = ${phase}`, { phase })
  },
)

// ---------- Run lifecycle ----------

server.registerTool(
  'start_run',
  {
    title: 'Begin a new experiment run',
    description:
      'Allocate the next run number, persist a `running` row, and return its id. Use this id when calling record_run_* / complete_run.',
    inputSchema: {
      title: z.string().min(1).optional(),
      branch: z.string().optional(),
      base_commit_sha: z.string().optional(),
    },
  },
  async ({ title, branch, base_commit_sha }) => {
    // Allocate next run number atomically (single-tenant DB so MAX is safe).
    const maxRow = await client.execute({
      sql: 'SELECT COALESCE(MAX(run_number), 0) AS n FROM experiment_runs WHERE experiment_id = ?',
      args: [EXPERIMENT_ID],
    })
    const next = Number(maxRow.rows[0]?.n ?? 0) + 1
    const id = `run_${randomUUID().slice(0, 12)}`
    await client.execute({
      sql: `INSERT INTO experiment_runs
              (id, experiment_id, run_number, status, title, branch, base_commit_sha)
            VALUES (?, ?, ?, 'running', ?, ?, ?)`,
      args: [
        id,
        EXPERIMENT_ID,
        next,
        title ?? null,
        branch ?? null,
        base_commit_sha ?? null,
      ],
    })
    return ok(`Run ${next} started: ${id}`, { run_id: id, run_number: next })
  },
)

server.registerTool(
  'record_run_metric',
  {
    title: 'Record a metric value for a run',
    description:
      'Persist one (run, metric) sample. Pass `passed=true/false` if you can decide locally; otherwise leave undefined.',
    inputSchema: {
      run_id: z.string().min(1),
      metric_id: z.string().min(1),
      value: z.union([z.number(), z.string()]),
      passed: z.boolean().optional(),
    },
  },
  async ({ run_id, metric_id, value, passed }) => {
    const draft = await loadDraft()
    const m = (draft.metrics ?? []).find((x) => x.id === metric_id)
    const id = `mm_${randomUUID().slice(0, 8)}`
    await client.execute({
      sql: `INSERT INTO run_metrics
              (id, run_id, metric_id, metric_name, value, passed, unit)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        run_id,
        metric_id,
        m?.name ?? metric_id,
        String(value),
        passed === undefined ? null : passed ? 1 : 0,
        m?.unit ?? null,
      ],
    })
    return ok(`Metric ${metric_id} recorded`, { id })
  },
)

server.registerTool(
  'record_run_artifact',
  {
    title: 'Record an output artifact captured during a run',
    description:
      'Logs/JSON/screenshots written by the harness. Pass either the filesystem `path` (relative to the cloned repo) or a small inline `content_preview` (≤ 16 KB) — both is fine. The full file stays on disk in the run\'s artifact dir.',
    inputSchema: {
      run_id: z.string().min(1),
      artifact_id: z.string().min(1),
      name: z.string().min(1),
      path: z.string().optional(),
      content_preview: z.string().max(16384).optional(),
      byte_size: z.number().int().min(0).optional(),
    },
  },
  async ({ run_id, artifact_id, name, path, content_preview, byte_size }) => {
    const id = `ra_${randomUUID().slice(0, 8)}`
    await client.execute({
      sql: `INSERT INTO run_artifacts
              (id, run_id, artifact_id, name, path, content_preview, byte_size)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        run_id,
        artifact_id,
        name,
        path ?? null,
        content_preview ?? null,
        byte_size ?? null,
      ],
    })
    return ok(`Artifact ${name} recorded`, { id })
  },
)

server.registerTool(
  'record_run_evaluator_outcome',
  {
    title: 'Record a sub-goal evaluator outcome for a run',
    description:
      'Pass / fail per sub-goal. `output` should be the assertion result (or reviewer JSON for qualitative ones).',
    inputSchema: {
      run_id: z.string().min(1),
      subgoal_id: z.string().min(1),
      passed: z.boolean(),
      output: z.string().optional(),
      error_message: z.string().optional(),
    },
  },
  async ({ run_id, subgoal_id, passed, output, error_message }) => {
    const id = `ev_${randomUUID().slice(0, 8)}`
    await client.execute({
      sql: `INSERT INTO run_evaluator_outcomes
              (id, run_id, subgoal_id, passed, output, error_message)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        run_id,
        subgoal_id,
        passed ? 1 : 0,
        output ?? null,
        error_message ?? null,
      ],
    })
    return ok(`Evaluator outcome recorded`, { id })
  },
)

server.registerTool(
  'complete_run',
  {
    title: 'Mark a run finished',
    description:
      'Set the final status (passed | failed | cancelled), commit sha + tag, and short summary. The summary is what the next-run review reads back.',
    inputSchema: {
      run_id: z.string().min(1),
      status: z.enum(['passed', 'failed', 'cancelled']),
      summary: z.string().min(1),
      commit_sha: z.string().optional(),
      tag: z.string().optional(),
      error_message: z.string().optional(),
    },
  },
  async ({ run_id, status, summary, commit_sha, tag, error_message }) => {
    await client.execute({
      sql: `UPDATE experiment_runs
              SET status = ?, summary = ?, commit_sha = ?, tag = ?,
                  error_message = ?, completed_at = unixepoch()
              WHERE id = ?`,
      args: [
        status,
        summary,
        commit_sha ?? null,
        tag ?? null,
        error_message ?? null,
        run_id,
      ],
    })
    return ok(`Run ${run_id} completed (${status})`, { id: run_id })
  },
)

server.registerTool(
  'list_recent_runs',
  {
    title: 'List recent runs for this experiment',
    description:
      'Returns the last N runs (default 10), most recent first, with status, summary, sub-goal pass count, and metric snapshot. Use this to learn from previous runs before iterating.',
    inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
  },
  async ({ limit }) => {
    const rows = await client.execute({
      sql: `SELECT r.id, r.run_number, r.status, r.title, r.summary,
                   r.commit_sha, r.tag, r.error_message, r.started_at, r.completed_at
              FROM experiment_runs r
              WHERE r.experiment_id = ?
              ORDER BY r.run_number DESC
              LIMIT ?`,
      args: [EXPERIMENT_ID, limit],
    })
    return ok(JSON.stringify(rows.rows, null, 2), { runs: rows.rows })
  },
)

// ---------- Harness ----------

server.registerTool(
  'set_harness',
  {
    title: 'Set the harness description / code',
    description:
      'Set the repeatable run script: setup, execute, capture artifacts. Code is optional but encouraged once the description is agreed.',
    inputSchema: {
      description: z.string().min(20),
      code: z.string().optional(),
    },
  },
  async ({ description, code }) => {
    const draft = await loadDraft()
    draft.harness = { description: description.trim(), code }
    await saveDraft(draft)
    return ok(`Harness updated.`, {})
  },
)

// ---------- Read-back ----------

server.registerTool(
  'get_draft',
  {
    title: 'Read the current experiment draft',
    description:
      'Return the live state of goal, sub-goals, artifacts, and harness.',
    inputSchema: {},
  },
  async () => {
    const draft = await loadDraft()
    return ok(JSON.stringify(draft, null, 2), draft)
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)

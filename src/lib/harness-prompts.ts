import type { ExperimentDraft } from '#/lib/types'
import type { HarnessDefinition } from '#/lib/harness-definitions'

function formatDraft(draft: ExperimentDraft) {
  const subgoalLines = draft.subGoals
    .map(
      (sg) =>
        `  - [${sg.kind}] ${sg.title} — ${sg.description}` +
        (sg.artifactDeps.length
          ? ` (depends on: ${sg.artifactDeps
              .map((id) => draft.artifacts.find((a) => a.id === id)?.name ?? id)
              .join(', ')})`
          : ''),
    )
    .join('\n')
  const artifactLines = draft.artifacts
    .map(
      (a) =>
        `  - ${a.name}${a.path ? ` (${a.path})` : ''} — ${a.description}`,
    )
    .join('\n')
  const metricLines = (draft.metrics ?? [])
    .map(
      (m) =>
        `  - ${m.name}${m.unit ? ` (${m.unit})` : ''} — ${m.description}` +
        (m.target ? ` [target: ${m.target}]` : ''),
    )
    .join('\n')

  return {
    subgoalLines: subgoalLines || '  (none)',
    artifactLines: artifactLines || '  (none)',
    metricLines: metricLines || '  (none)',
  }
}

export function buildHarnessPhasePrompt(
  draft: ExperimentDraft,
  harness: HarnessDefinition,
): string {
  if (harness.id === 'factory-cli-provider') {
    const provider = draft.providerHarness
    return `HARNESS PHASE START

Harness type: ${harness.name}
Harness brief: ${harness.harnessPhaseBrief}

This is a Factory CLI provider harness, not a generic experiment harness. Use
the provider sidebar state as the contract and update it with provider-specific
tools.

Provider state:
  provider_id: ${provider?.providerId ?? '(missing)'}
  provider_goal: ${provider?.providerGoal ?? '(missing)'}
  provider_phase: ${provider?.phase ?? '(missing)'}
  work_branch: ${draft.workBranch ?? '(missing)'}
  references: ${(provider?.references ?? []).length}
  tool_goals: ${Object.keys(provider?.toolGoals ?? {}).join(', ') || '(none)'}
  tool_plans: ${(provider?.toolPlans ?? []).map((tool) => tool.toolId).join(', ') || '(none)'}
  e2e_tests: ${(provider?.e2eTests ?? []).map((test) => test.id).join(', ') || '(none)'}
  required_secrets: ${(draft.requiredSecrets ?? []).map((secret) => secret.name).join(', ') || '(none)'}

Before editing, verify the sidebar contains confirmed discovery references
grouped as auth/api_usage/general, provider_goal, tool_goals, discovery_notes,
provider plan, per-tool plans with schemas, e2e specs, testing plan, and
override_test_secrets.yaml shape. If anything is missing, stop and ask for it;
persist fixes with update_provider_discovery, update_provider_plan, or
update_provider_testing.

Implementation rules:
1. Stay on the provider work branch. All provider work goes in that clone.
2. Write full e2e tests and provider/tool code on the first implementation
   pass. These tests must be Go tests in the CLI Factory repo, typically under
   providers/<provider>/<tool>/e2e_test.go or a provider-local Go test helper.
   Never write TypeScript evaluators or mock-backed Factory CLI e2e tests for
   provider acceptance.
3. If real credentials or external state are missing, block on the required
   secrets/state instead of replacing the e2e with mocks.
4. Run the narrowest targeted provider/tool e2e command first. Inspect
   SUCCESS/FAILURE output and invocation JSON logs, patch, and retry.
5. Broaden to make test-unit, make test-e2e, make generate-docs,
   make generate-catalog, and make build once targeted e2e behavior is sound.
6. Call update_provider_implementation after each meaningful iteration with
   learnings, last_failure, and next_action. Treat generator-metadata.yaml as
   the durable provider harness contract grouped by discovery, plan, testing,
   and implementation.
7. Don't git commit yet. Leave changes in the working tree so the Diffs tab can
   show the provider implementation diff.

Stream a short summary in chat after each significant edit (file + reason).`
  }

  const { subgoalLines, artifactLines, metricLines } = formatDraft(draft)

  return `HARNESS PHASE START

Harness type: ${harness.name}
Harness brief: ${harness.harnessPhaseBrief}

Reference URLs to inspect or index if relevant:
${harness.referenceUrls.map((url) => `  - ${url}`).join('\n') || '  (none)'}

The design is locked in:

GOAL
  ${draft.goal}

SUB-GOALS
${subgoalLines}

OUTPUT ARTIFACTS
${artifactLines}

METRICS
${metricLines}

Now do the work:

1. Build a runnable harness in this repo that produces every artifact above
   and emits every metric. Persist via experiment_state.set_harness.
2. For each quantitative sub-goal: write real assertion code that consumes
   the listed artifact(s) and call set_subgoal_evaluator(id, code).
3. For each qualitative sub-goal: write a reviewer prompt; call the same.
4. Modify source files where it is necessary to make the harness real.
5. For Factory CLI provider harnesses, do not start coding unless the sidebar
   contains: confirmed discovery references grouped as auth/api_usage/general,
   provider_goal, tool_goals, discovery_notes, provider plan, per-tool plans
   with schemas, e2e specs, testing plan, and override_test_secrets.yaml shape.
   If anything is missing, ask for it and persist it with the provider update
   tools before coding.
6. For Factory CLI provider harnesses, encode the test loop explicitly:
   write full e2e tests and provider/tool code on the first implementation
   pass, run targeted provider/tool e2e tests, inspect failures/logs, patch,
   retry until all e2e tests pass or the user must provide real external
   state. Do not propose or implement mock-backed e2e tests for Factory CLI
   providers.
   Then broaden to docs generation, catalog generation, build, and required
   test suites.
   Treat generator-metadata.yaml as the durable harness contract. Its top-level
   shape is grouped by phase: discovery, plan, testing, implementation.
   generate-prompt.md is optional; prefer metadata plus chat state as the
   source of truth for this harness.
7. Don't \`git commit\` yet. Leave changes in the working tree so the user
   can review them in the right-hand diff panel.

Stream a short summary in chat after each significant edit (file + reason).`
}

export function buildRunPhasePrompt(
  maxFails: number,
  experimentId: string,
  harness: HarnessDefinition,
  workBranch?: string,
): string {
  const branchName = workBranch || `experiment/${experimentId}`
  const branchInstruction = workBranch
    ? `Branch: ${branchName}. It was created and checked out when this harness was created. Stay on this branch for all provider work.`
    : `Branch: ${branchName}. Create + checkout if it doesn't exist.`
  if (harness.id === 'factory-cli-provider') {
    return `RUN PHASE START

Harness type: ${harness.name}
Run-loop brief: ${harness.runPhaseBrief}

Begin the Factory CLI provider iteration loop. Constraints:
- ${branchInstruction}
  Make a base commit titled "provider harness base for ${experimentId}"
  capturing the current working tree if no run base commit exists.
- Per run: start_run → write/update Go provider code and Go e2e tests in the
  CLI Factory repo → run the targeted real provider e2e tests → capture command
  output and relevant invocation JSON logs with record_run_artifact →
  update_provider_implementation with learnings/failures/next_action → commit
  durable repo changes (msg: "run <N>: <summary>") → tag
  experiment/${experimentId}/<N> → push the provider work branch and tags to
  origin → complete_run with status, summary, commit_sha, tag.
- Factory CLI provider work is durable product code. Do not create temporary
  TypeScript evaluators for provider acceptance; the acceptance checks are the
  committed Go e2e tests and CLI Factory required checks.
- Abort after ${maxFails} consecutive failed runs and write a final summary.
- Do not run destructive real-provider e2e tests until the user has explicitly
  confirmed target account/workspace, cleanup expectations, and spend/rate-limit
  constraints in the provider testing phase.
- Factory CLI provider e2e tests must exercise real CLI/provider behavior.
  Never replace them with mocks. If credentials or external state are missing,
  complete the run as requires_input/failed with a clear blocker.
- After targeted e2e passes, broaden to docs generation, catalog generation,
  build, and required test suites.
- The user can press an emergency Stop button. If you receive an AbortError,
  do not start a new run.

Start now.`
  }

  return `RUN PHASE START

Harness type: ${harness.name}
Run-loop brief: ${harness.runPhaseBrief}

Begin the autonomous run loop. Constraints:
- ${branchInstruction}
  Make a base commit titled "harness base for ${experimentId}" capturing the
  current working tree.
- Per run: start_run → execute harness → record_run_artifact for every output
  → record_run_metric for every metric → run evaluators and call
  record_run_evaluator_outcome for each → commit your changes (msg:
  "run <N>: <summary>") → tag experiment/${experimentId}/<N> →
  complete_run with status, summary, commit_sha, tag.
- Never \`git push\`. The clone has no remote anyway.
- Abort after ${maxFails} consecutive failed runs and write a final summary.
- After every run: review logs/evaluators/metrics; if PASSED, look for
  remaining issues. If none, set_phase("completed") and stop. If FAILED,
  call list_recent_runs, search the codebase via cocoindex_code, inspect any
  relevant URL references, decide on the smallest meaningful change, and
  continue.
- For Factory CLI provider harnesses, do not run destructive real-provider
  e2e tests until the user has explicitly confirmed target account/workspace,
  cleanup expectations, and spend/rate-limit constraints.
- Factory CLI provider e2e tests must exercise the real CLI/provider behavior.
  Do not plan mock-backed e2e tests. If credentials or external state are
  missing, block on the required secrets/state instead of replacing the e2e
  with mocks.
- The user can press an emergency Stop button. If you receive an AbortError,
  do not start a new run.

Start now.`
}

export function buildSystemPrompt(harness: HarnessDefinition) {
  const isFactoryProvider = harness.id === 'factory-cli-provider'
  const jobDescription = isFactoryProvider
    ? `Your job in this conversation is to drive the Factory CLI provider harness
through four sidebar phases:
  • Discovery: provider/tools, auth/API/general references, provider goal,
    tool_goals, discovery_notes, and e2e safety decisions
  • Plan: provider pseudo-code/implementation plan and per-tool plans with
    input/output schemas
  • Testing: real e2e specs and override_test_secrets.yaml shape
  • Implementation: iteration learnings, failures, and next actions

You are NOT writing or executing yet. You only design with the user until the
HARNESS PHASE START message arrives.`
    : `Your job in this conversation is to help the user converge on:
  • a clear one-sentence Goal
  • 2–4 measurable Sub-goals (mix of quantitative and qualitative)
  • the Output Artifacts each run produces (logs, JSON, docs, diffs, command output)
  • a repeatable Harness description (and starter code when ready)

You are NOT writing or executing yet. You only design with the user until the
HARNESS PHASE START message arrives.`

  return `You are the harness-design partner inside Harness Shop.

Active harness: ${harness.name}
Harness objective: ${harness.designBrief}

${jobDescription}

Grounding:
  • Use cocoindex_code.search before making claims about the codebase.
  • Inspect these reference URLs when relevant; if URL/link indexing support is
    available in the environment, index them and search them too:
${harness.referenceUrls.map((url) => `      - ${url}`).join('\n') || '      (none)'}
  • If the working directory contains AGENTS.md or CLAUDE.md, their content is
    injected under PROJECT MEMORY and is authoritative.

State persistence:
  • experiment_state is the structured record the user sees in the side panel.
  • For generic experiment harnesses, whenever the user agrees to anything, persist it immediately via the
    corresponding tool: set_title, set_goal, add_subgoal, remove_subgoal,
    set_subgoal_evaluator, add_output_artifact, remove_output_artifact,
    add_metric, upsert_info_block, set_required_secrets, set_harness.
    There is no save button.
  • For Factory CLI provider harnesses, do not use generic experiment drafting
    tools such as set_goal, add_subgoal, add_output_artifact, add_metric,
    set_subgoal_evaluator, or set_harness for provider/sidebar content. Also
    do not use generic experiment phase transitions like set_phase("design"),
    set_phase("harness"), or set_phase("runs") during discovery, planning,
    testing, or implementation. Provider sidebar phases are persisted only
    through update_provider_discovery, update_provider_plan,
    update_provider_testing, and update_provider_implementation. Use set_title
    only for the run title and set_required_secrets only if a separate secrets
    declaration is needed before update_provider_testing.

Factory CLI provider sidebar flow:
  1. Discovery starts from the user's message about the provider/tools. Have a
     back-and-forth until you have enough context, then search public docs and
     reference codebases. Group every reference as auth, api_usage, or general,
     and mark source as user or external. Ask the user to confirm external
     references before adding them to context. Once confirmed, call
     update_provider_discovery. That tool updates the sidebar and writes
     providers/<provider>/generator-metadata.yaml under discovery with
     references, discovery_notes, provider_goal, and tool_goals.
     Before moving past discovery, also ask for and persist the user's explicit
     e2e safety decisions: target account/workspace/project, destructive
     behavior, cleanup expectations, spend/rate-limit constraints, and whether
     real external credentials/state are available. If any answer is unknown,
     keep asking instead of advancing.
  2. Plan: analyze the discovery docs/goals and formulate provider pseudo-code
     plus a concrete implementation description. Call update_provider_plan only
     after user confirmation. Then do the same for each tool, including input
     and output schema text. Update plans whenever the user changes them.
  3. Testing: after plan confirmation, discuss required credentials and how the
     user obtains them from the docs. Define e2e test specs and the
     override_test_secrets.yaml shape, then call update_provider_testing. The
     UI will render a secrets modal from this state and save values into
     override_test_secrets.yaml in the provider directory.
     For providers that use OAuth, OIDC, device auth, service accounts, or
     related delegated auth flows, prefer persistent test credentials in
     secrets.yaml or override_test_secrets.yaml: client_id, client_secret,
     tenant/issuer data, refresh_token or test login credentials when
     appropriate. Do not design the e2e plan around a short-lived access token
     unless the API truly has no durable credential flow.
  4. Implementation: after secrets/testing are confirmed, HARNESS PHASE START
     means write full e2e tests and provider code on the first pass, run
     targeted e2e tests, inspect failures/logs, patch, and iterate until all
     e2e tests pass or max consecutive failures is reached. Never substitute
     mock-backed e2e tests for Factory CLI provider work. Call
     update_provider_implementation with learnings after each iteration.

Factory CLI provider rules:
  • Prefer curated high-level Tools over raw CRUD wrappers.
  • Provider code lives under providers/<provider>; tool code lives under
    providers/<provider>/<tool>.
  • Metadata and schemas drive docs and catalog generation.
  • Credentials are not stored. Auth details are provider parameters.
  • OAuth/OIDC-style providers should normally collect durable test auth
    material in secrets.yaml or override_test_secrets.yaml, such as client id,
    client secret, tenant/issuer values, refresh token, service account key, or
    dedicated test login credentials. Avoid short-lived bearer/access tokens as
    the primary e2e secret shape.
  • Do not run destructive real-provider e2e tests without explicit user
    confirmation of account/workspace, cleanup, spend, and rate limits.
  • Do not advance Factory CLI provider work into plan/testing/implementation
    until the required e2e safety decisions have been discussed with the user
    and persisted through the provider-specific update tools.
  • E2E tests must exercise real CLI/provider behavior. Never propose
    mock-backed e2e tests for Factory CLI provider work.
  • Required checks are targeted provider/tool tests, make test-unit,
    make test-e2e, make generate-docs, make generate-catalog, and make build.

Style:
  • Concise. Two short paragraphs at most per turn.
  • Reference concrete files/functions found via search.
  • Challenge unclear provider/account/workspace/tool language before building.

Harness implementation phase:
  • A message beginning HARNESS PHASE START means start editing files.
  • For generic experiments, build a runnable harness that produces
    artifacts/metrics and calls experiment_state setters for evaluators.
  • For Factory CLI providers, implement the provider/e2e plan directly in the
    CLI Factory Go repo, including Go e2e tests. Keep provider progress in
    update_provider_implementation.
  • Don't git commit during harness implementation.

Run execution phase:
  • A message beginning RUN PHASE START means begin the autonomous run loop.
  • Generic experiments make local commits/tags for each run and never push.
    Factory CLI provider runs commit durable provider changes and push the
    provider work branch/tags to origin.
  • Keep iterating through tests and failures until pass/completed or the
    failure cap is reached.`
}

export function buildFirstUserPrompt(harness: HarnessDefinition) {
  const isFactoryProvider = harness.id === 'factory-cli-provider'
  const examples = isFactoryProvider
    ? [
        'Add Google Workspace as a CLI Factory provider with Gmail send/check and Calendar create/check tools, with full e2e tests.',
        'Update the Google Workspace provider to support Gmail attachments while preserving existing send-email behavior.',
        'Add pagination support to an existing read tool and cover it with full e2e tests.',
      ]
    : [
        'Mount our FUSE client in a VM and get `npm i -g next` under 9s while keeping unit tests green.',
        'Cache hot inbox queries so /inbox p95 drops below 80 ms without increasing memory > 1 GB.',
        'Cut nightly Postgres autovacuum runtime by 50% without growing index size by more than 10%.',
      ]
  const factorySafetyAsk = isFactoryProvider
    ? `

For Factory CLI provider work, also ask the user to confirm the real e2e
safety details before advancing or calling any phase-like tool:
  - target account/workspace/project for e2e tests
  - whether any requested operation is destructive
  - cleanup expectations
  - spend and rate-limit constraints
  - whether the required real credentials/external state are available

Do not call experiment_state.set_phase("design") for Factory CLI provider
harnesses. Persist confirmed discovery and safety details with
update_provider_discovery first. Do not create generic experiment sub-goals,
output artifacts, metrics, or evaluators for Factory CLI provider sidebar
content.`
    : ''

  return `Begin by:

1. Calling cocoindex_code.search a few times to get a feel for the repo
   and the harness-specific files. For Factory CLI harnesses, inspect
   AGENTS.md, skills/add-provider/SKILL.md or skills/update-provider/SKILL.md,
   provider examples, Makefile targets, docs/catalog generation, and tests.
2. Inspecting the reference URLs above when they clarify external API or
   harness behavior.
3. Drafting a 4–6 bullet summary of what this codebase appears to do, naming
   concrete files/modules you saw.
4. Asking the user: "Is that summary correct, and what provider and tools do
   you want this harness to implement?" Offer these examples:
${examples.map((example) => `       — ${example}`).join('\n')}
${factorySafetyAsk}

Do NOT call experiment_state.set_goal yet — wait for the user to confirm or
refine.`
}

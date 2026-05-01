---
name: harness-experiment-loop
description: >-
  How to drive a single experiment from design through autonomous run loop.
  Read this when you're being asked to author or extend the harness
  workflow inside this repo.
---

# Harness experiment loop

This skill explains the *contract* the agent has with the rest of the
system during a run-phase experiment.

## Lifecycle

1. **Design phase** (`experiments.phase = 'design'`). The agent talks
   with the user, calls `cocoindex_code.search` to ground itself in the
   target repo, and persists structured state via `experiment_state.*`:
   - `set_title` / `set_goal`
   - `add_subgoal` / `remove_subgoal` / `set_subgoal_evaluator`
   - `add_output_artifact` / `remove_output_artifact`
   - `add_metric` / `remove_metric`
2. **Harness phase** (`phase = 'harness'`). User clicks
   *Generate harness & evaluators*; the chat receives a message starting
   with `HARNESS PHASE START`. Agent edits the cloned repo, lays down a
   harness script + evaluator code/prompt for each sub-goal, and calls
   `set_harness`.
3. **Runs phase** (`phase = 'runs'`). User sets a max-fail threshold,
   clicks *Start runs*. Chat receives `RUN PHASE START`. Agent runs the
   loop:
   - One-time setup: branch `experiment/<id>`, base commit.
   - Per run: `start_run` → execute harness → record artifacts/metrics/
     evaluator outcomes → commit + tag → `complete_run`.
   - Review prior runs (`list_recent_runs`, semantic search), decide on
     the next change, repeat.
4. **Done**. Agent calls `set_phase('completed')` once the goal is met
   (or aborts on consecutive failures).

## Persistence rules

- **Belt-and-braces metrics.** For every metric the harness emits, write
  it both to `record_run_metric(...)` *and* into a file artifact
  `metrics.json` that's also captured via `record_run_artifact`. If the
  DB call fails, the truth survives on disk and the next-run review can
  replay it.
- **Same for evaluator outcomes**: capture them as JSON in the run's
  artifact dir before mirroring through `record_run_evaluator_outcome`.
- **Don't `git push`.** The clone has no remote anyway; don't add one.
  Local commits + tags only.

## Approvals

The codex SDK is configured for fully autonomous operation: approval
policy `on-request`, reviewer `auto_review`, every MCP tool's
`default_tools_approval_mode` is `approve`. If you find a tool getting
auto-cancelled, that combo has been broken — don't paper over it with
retries; check `src/server/agent/codex-runner.ts`.

## What NOT to do

- Don't bypass `experiment_state.*` and write directly to the DB. The UI
  reads from the same tables and the right-panel polling depends on
  agent-side `tool-completion` ticks to refetch.
- Don't change `experiments.phase` without going through `set_phase` —
  the UI's button progression keys off it.
- Don't add a new approvals/sandbox mode; if you need looser permissions
  for a specific operation, add a `writable_root` for that path
  (precedent: `<clonePath>/.git`).

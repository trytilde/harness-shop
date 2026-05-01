import type { ExperimentDraft, SubGoal } from '#/lib/types'
import type { Stage } from '#/components/experiment/stepper'

export type DemoStep = {
  stage: Stage
  assistant: string
  applyDraft?: (d: ExperimentDraft) => ExperimentDraft
}

export const INITIAL_ASSISTANT_GREETING = `Hi! I'll help you frame this as a tight, runnable experiment.

Tell me what you want to optimise — try to be specific about what "better" looks like (a number, a behaviour, a pass/fail outcome). Don't worry about being perfect; we'll refine together.`

const SAMPLE_GOAL =
  'Mount the FUSE client inside a Firecracker VM and reduce the wall-clock time of `npm i -g next` to under 9 seconds, while keeping `npm test` green.'

const SAMPLE_ARTIFACTS = [
  {
    id: 'art_install_log',
    name: 'install.log',
    description: 'stdout/stderr from the npm install run, with timestamps.',
    path: 'artifacts/install.log',
  },
  {
    id: 'art_timing_json',
    name: 'timing.json',
    description: 'Wall-clock + per-phase timings written by the harness.',
    path: 'artifacts/timing.json',
  },
  {
    id: 'art_test_report',
    name: 'test-report.json',
    description: 'JUnit-style report from `npm test`.',
    path: 'artifacts/test-report.json',
  },
]

const SAMPLE_SUBGOALS: SubGoal[] = [
  {
    id: 'sg_install_time',
    kind: 'quantitative',
    title: 'npm install completes in < 9s',
    description: 'Wall-clock time of `npm i -g next` measured by the harness.',
    artifactDeps: ['art_timing_json'],
  },
  {
    id: 'sg_tests_pass',
    kind: 'quantitative',
    title: '100% of unit tests pass',
    description: 'All test cases in test-report.json must report status=passed.',
    artifactDeps: ['art_test_report'],
  },
  {
    id: 'sg_no_warnings',
    kind: 'qualitative',
    title: 'install.log free of FS warnings',
    description:
      'Reviewing agent confirms no FUSE warnings, EIO retries, or permission errors.',
    artifactDeps: ['art_install_log'],
  },
]

const SAMPLE_HARNESS = `1. Boot a Firecracker VM with our standard Debian rootfs and a 4 GiB data disk.
2. Mount the FUSE client at /mnt/pkg with the experimental flags under test.
3. Inside the VM:
   - \`time npm i -g next\` → write durations to artifacts/timing.json
   - \`npm test --reporter=json > artifacts/test-report.json\`
   - capture combined stdout+stderr to artifacts/install.log
4. Tear the VM down, archive artifacts/ to the run record.`

const SAMPLE_HARNESS_CODE = `// scripts/run.ts (drafted)
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const t0 = performance.now()
const proc = spawn('npm', ['i', '-g', 'next'], { stdio: 'pipe' })
let log = ''
proc.stdout.on('data', (d) => (log += d))
proc.stderr.on('data', (d) => (log += d))
await new Promise((r) => proc.on('close', r))
const elapsedMs = performance.now() - t0

writeFileSync('artifacts/install.log', log)
writeFileSync('artifacts/timing.json', JSON.stringify({ install_ms: elapsedMs }, null, 2))`

const QUANT_INSTALL_EVAL = `// quantitative evaluator for sg_install_time
import { readFileSync } from 'node:fs'

const { install_ms } = JSON.parse(
  readFileSync('artifacts/timing.json', 'utf8'),
)

if (typeof install_ms !== 'number') {
  throw new Error('timing.json missing install_ms')
}

if (install_ms >= 9_000) {
  throw new Error(\`install_ms=\${install_ms} (target < 9000)\`)
}`

const QUANT_TESTS_EVAL = `// quantitative evaluator for sg_tests_pass
import { readFileSync } from 'node:fs'

const report = JSON.parse(readFileSync('artifacts/test-report.json', 'utf8'))
const failed = report.tests.filter((t) => t.status !== 'passed')
if (failed.length > 0) {
  throw new Error(\`\${failed.length} failing tests\`)
}`

const QUAL_LOG_PROMPT = `You are reviewing artifacts/install.log from a single experiment run.

Pass criteria:
- No \`FUSE\` warnings.
- No \`EIO\` or \`EACCES\` errors.
- No retry loops (e.g. "retrying after error").
- npm exits cleanly with code 0.

Respond JSON: { passed: boolean, reasoning: string }.`

export const DEMO_STEPS: DemoStep[] = [
  {
    stage: 'goal',
    assistant: `Got it. Let me play that back as a single sentence so we share the same picture:

> ${SAMPLE_GOAL}

Two questions before we move on:
1. Is the time budget hard (< 9s) or soft (best-effort, regression-free)?
2. Do we care about cold-start only, or warm-cache runs too?

If both look right, say "looks good" and I'll propose sub-goals.`,
    applyDraft: (d) => ({ ...d, goal: SAMPLE_GOAL }),
  },
  {
    stage: 'subgoals',
    assistant: `Great. Here's a starting set of sub-goals tied to concrete artifacts:

• **Quantitative** — npm install completes in < 9s (timing.json)
• **Quantitative** — 100% unit tests pass (test-report.json)
• **Qualitative** — install.log free of FS warnings (reviewed by an agent)

Want me to add anything (memory ceiling? cache-cold variant?) or refine any of these before we move to the harness?`,
    applyDraft: (d) => ({
      ...d,
      artifacts: SAMPLE_ARTIFACTS,
      subGoals: SAMPLE_SUBGOALS,
    }),
  },
  {
    stage: 'harness',
    assistant: `Here's the harness shape. Each run produces the three artifacts above and is fully reproducible:

${SAMPLE_HARNESS}

I've drafted a starter \`scripts/run.ts\` — see the side panel. Tell me if anything looks off, otherwise we'll write the per-sub-goal evaluators next.`,
    applyDraft: (d) => ({
      ...d,
      harness: { description: SAMPLE_HARNESS, code: SAMPLE_HARNESS_CODE },
    }),
  },
  {
    stage: 'evaluators',
    assistant: `Evaluators wired in:

- Quantitative sub-goals get real assertion code (timing < 9s; zero failing tests).
- The qualitative sub-goal gets a reviewer prompt that consumes install.log and returns JSON.

Take a look at the right panel and tell me if you'd like to tighten any thresholds before we commit.`,
    applyDraft: (d) => ({
      ...d,
      subGoals: d.subGoals.map((sg) => {
        if (sg.id === 'sg_install_time') return { ...sg, evaluator: QUANT_INSTALL_EVAL }
        if (sg.id === 'sg_tests_pass') return { ...sg, evaluator: QUANT_TESTS_EVAL }
        if (sg.id === 'sg_no_warnings') return { ...sg, evaluator: QUAL_LOG_PROMPT }
        return sg
      }),
    }),
  },
  {
    stage: 'confirm',
    assistant: `We're ready. Hit **Launch experiment** to clone the repo, build the harness, and start the first run. You can keep editing any of the panels afterward — each change creates a new harness version.`,
  },
]

import { Beaker, Blocks } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type HarnessId =
  | 'experiment'
  | 'factory-cli-provider'

export type HarnessDefinition = {
  id: HarnessId
  name: string
  shortName: string
  description: string
  cta: string
  icon: LucideIcon
  accent: string
  requiredRepoHint?: string
  referenceUrls: string[]
  designBrief: string
  harnessPhaseBrief: string
  runPhaseBrief: string
}

export const HARNESS_DEFINITIONS: HarnessDefinition[] = [
  {
    id: 'experiment',
    name: 'Experiment',
    shortName: 'Experiment',
    description:
      'Design a measurable optimization harness, implement evaluators, and self-iterate through runs.',
    cta: 'Go to harness',
    icon: Beaker,
    accent: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
    referenceUrls: ['https://github.com/cocoindex-io/cocoindex-code'],
    designBrief:
      'Help the user turn a vague codebase optimization goal into a runnable experiment with sub-goals, artifacts, metrics, and evaluators.',
    harnessPhaseBrief:
      'Build a runnable experiment harness and evaluator set that emits artifacts and metrics for repeated comparison.',
    runPhaseBrief:
      'Run the harness, evaluate outcomes, commit each iteration locally, and continue until the goal passes or the failure cap is reached.',
  },
  {
    id: 'factory-cli-provider',
    name: 'Factory CLI Provider',
    shortName: 'Provider',
    description:
      'Add or update a CLI Factory provider with discovery, plans, e2e specs, secrets, docs, catalog entries, and iterative tests.',
    cta: 'Go to harness',
    icon: Blocks,
    accent: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    requiredRepoHint: 'Designed for trytilde/cli-factory.',
    referenceUrls: [
      'https://github.com/trytilde/cli-factory',
      'https://github.com/cocoindex-io/cocoindex-code',
    ],
    designBrief:
      'Guide the user through a structured add-or-update provider harness for CLI Factory. Resolve provider id, provider params, curated high-level tools, destructive behavior, auth model, docs/catalog effects, and e2e safety before implementation.',
    harnessPhaseBrief:
      'Generate an implementation plan, tests, and fixture strategy for adding or updating the provider. The harness must execute targeted provider tests, docs generation, catalog generation, build, and keep iterating on failures until the provider is complete or blocked by missing real credentials.',
    runPhaseBrief:
      'Autonomously add or update the provider in small iterations. After every change run the narrowest relevant command first, inspect failures/logs, fix, and broaden to CLI Factory required checks. Do not run destructive real-provider e2e tests without explicit confirmation.',
  },
]

export const DEFAULT_HARNESS_ID: HarnessId = 'experiment'

export function getHarnessDefinition(id: string | null | undefined) {
  return (
    HARNESS_DEFINITIONS.find((harness) => harness.id === id) ??
    HARNESS_DEFINITIONS[0]
  )
}

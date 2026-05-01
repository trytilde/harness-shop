export type ConnectionId = 'github' | 'codex'

export type ConnectionStatus = {
  id: ConnectionId
  label: string
  description: string
  connected: boolean
  username?: string
  avatarUrl?: string
}

export type ExperimentStatus =
  | 'running'
  | 'finished'
  | 'failed'
  | 'requires_input'
  | 'draft'

export type ExperimentRef =
  | { kind: 'branch'; branch: string; commit?: string }
  | { kind: 'commit'; commit: string; branch?: string }
  | { kind: 'pr'; number: number; branch?: string; commit?: string }

export type Experiment = {
  id: string
  repoOrg: string
  repoName: string
  ref: ExperimentRef
  title: string
  goal: string
  status: ExperimentStatus
  updatedAt: string
}

export type SubGoalKind = 'quantitative' | 'qualitative'

export type OutputArtifact = {
  id: string
  name: string
  description: string
  path?: string
}

export type SubGoal = {
  id: string
  kind: SubGoalKind
  title: string
  description: string
  artifactDeps: string[]
  /** quantitative: assertion code; qualitative: agent prompt */
  evaluator?: string
}

/** A measurable quantitative value the harness emits each run. */
export type Metric = {
  id: string
  name: string
  description: string
  unit?: string
  /** Optional target value with comparison: e.g. "<= 9000". Free-text. */
  target?: string
}

export type ExperimentPhase = 'design' | 'harness' | 'runs' | 'completed'

export type RunStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'cancelled'

export type ExperimentRun = {
  id: string
  experimentId: string
  runNumber: number
  status: RunStatus
  title: string | null
  summary: string | null
  branch: string | null
  baseCommitSha: string | null
  commitSha: string | null
  tag: string | null
  errorMessage: string | null
  startedAt: number
  completedAt: number | null
  /** Aggregate counts surfaced in the table. */
  subgoalsPassed: number
  subgoalsTotal: number
  evaluatorsPassed: number
  evaluatorsTotal: number
}

export type ExperimentDraft = {
  repo: { org: string; name: string }
  ref: ExperimentRef
  goal: string
  subGoals: SubGoal[]
  artifacts: OutputArtifact[]
  metrics: Metric[]
  harness: {
    description: string
    code?: string
  }
}

export type Repo = {
  org: string
  name: string
  defaultBranch: string
  private: boolean
  description?: string
}

export type Branch = {
  name: string
  commit: string
  protected?: boolean
}

import { useEffect, useState } from 'react'
import {
  Activity,
  Beaker,
  FileOutput,
  Gauge,
  Play,
  Rocket,
  Sparkles,
  Target,
} from 'lucide-react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { ScrollArea } from '#/components/ui/scroll-area'
import type { ExperimentDraft, ExperimentPhase } from '#/lib/types'

export function DraftPanel({
  draft,
  agentPending,
  phase,
  maxConsecutiveFailures,
  onGenerateHarness,
  onStartRuns,
  onMaxConsecutiveFailuresChange,
}: {
  draft: ExperimentDraft
  agentPending: boolean
  phase: ExperimentPhase
  maxConsecutiveFailures: number | null
  onGenerateHarness: () => void
  onStartRuns: (maxFails: number) => void
  onMaxConsecutiveFailuresChange: (value: number) => void
}) {
  const hasGoal = draft.goal.trim().length > 0
  const hasSubGoals = draft.subGoals.length > 0
  const hasArtifacts = draft.artifacts.length > 0
  const hasHarness = draft.harness.description.trim().length > 0
  const hasEvaluators = hasSubGoals && draft.subGoals.some((sg) => sg.evaluator)
  const hasMetrics = (draft.metrics ?? []).length > 0

  const canGenerate = hasGoal && hasSubGoals && hasArtifacts
  const canStartRuns =
    hasHarness && hasEvaluators && (maxConsecutiveFailures ?? 0) > 0

  const [maxFailDraft, setMaxFailDraft] = useState<string>(
    maxConsecutiveFailures != null ? String(maxConsecutiveFailures) : '3',
  )
  useEffect(() => {
    if (maxConsecutiveFailures != null) {
      setMaxFailDraft(String(maxConsecutiveFailures))
    }
  }, [maxConsecutiveFailures])


  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden">
      <ScrollArea className="w-full min-h-0 min-w-0 flex-1">
        <div className="space-y-8 px-4 py-3 min-w-0 max-w-full">
          <Section icon={<Target className="size-4" />} label="Goal">
            {hasGoal ? (
              <p className="text-sm whitespace-pre-wrap break-words">
                {draft.goal}
              </p>
            ) : (
              <Empty>The agent will distill your goal into one clear sentence here.</Empty>
            )}
          </Section>

          <Section
            icon={<Gauge className="size-4" />}
            label="Sub-goals"
            right={
              hasSubGoals ? (
                <Badge variant="secondary">{draft.subGoals.length}</Badge>
              ) : null
            }
          >
            {hasSubGoals ? (
              <div className="space-y-2 min-w-0">
                {draft.subGoals.map((sg) => (
                  <div key={sg.id} className="text-sm min-w-0">
                    <div className="mb-1 flex items-start gap-2 min-w-0">
                      <Badge
                        variant={sg.kind === 'quantitative' ? 'default' : 'secondary'}
                        className="shrink-0 text-[10px] uppercase"
                      >
                        {sg.kind}
                      </Badge>
                      <span className="font-medium break-words min-w-0">
                        {sg.title}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-xs break-words">
                      {sg.description}
                    </p>
                    {sg.artifactDeps.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1 min-w-0">
                        <span className="text-muted-foreground text-[10px]">
                          Depends on:
                        </span>
                        {sg.artifactDeps.map((id) => {
                          const a = draft.artifacts.find((x) => x.id === id)
                          return (
                            <code
                              key={id}
                              className="bg-muted text-muted-foreground max-w-full break-all rounded px-1 py-0.5 font-mono text-[10px]"
                            >
                              {a?.name ?? id}
                            </code>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty>
                Once the goal is set, the agent will propose 2–4 quantitative or
                qualitative sub-goals.
              </Empty>
            )}
          </Section>

          <Section
            icon={<FileOutput className="size-4" />}
            label="Output artifacts"
            right={
              hasArtifacts ? (
                <Badge variant="secondary">{draft.artifacts.length}</Badge>
              ) : null
            }
          >
            {hasArtifacts ? (
              <div className="space-y-2 min-w-0">
                {draft.artifacts.map((a) => (
                  <div key={a.id} className="text-sm min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 min-w-0">
                      <span className="font-medium break-words min-w-0">
                        {a.name}
                      </span>
                      {a.path && (
                        <code className="bg-muted text-muted-foreground ml-auto max-w-full break-all rounded px-1.5 py-0.5 font-mono text-[10px]">
                          {a.path}
                        </code>
                      )}
                    </div>
                    <p className="text-muted-foreground text-xs break-words">
                      {a.description}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>
                Files (logs, JSON, screenshots) the harness writes each run, used
                to evaluate sub-goals.
              </Empty>
            )}
          </Section>

          <Section
            icon={<Activity className="size-4" />}
            label="Metrics"
            right={
              hasMetrics ? (
                <Badge variant="secondary">{draft.metrics.length}</Badge>
              ) : null
            }
          >
            {hasMetrics ? (
              <div className="space-y-2 min-w-0">
                {draft.metrics.map((m) => (
                  <div key={m.id} className="text-sm min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 min-w-0">
                      <span className="font-medium break-words min-w-0">
                        {m.name}
                      </span>
                      {m.unit && (
                        <span className="text-muted-foreground text-[10px]">
                          ({m.unit})
                        </span>
                      )}
                      {m.target && (
                        <code className="bg-muted text-muted-foreground ml-auto break-all rounded px-1.5 py-0.5 font-mono text-[10px]">
                          {m.target}
                        </code>
                      )}
                    </div>
                    <p className="text-muted-foreground text-xs break-words">
                      {m.description}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>
                Quantitative values the harness emits each run. The agent will
                propose a few during design — the Runs tab graphs them over
                time.
              </Empty>
            )}
          </Section>

          <Section icon={<Beaker className="size-4" />} label="Harness">
            {hasHarness ? (
              <>
                <p className="text-sm whitespace-pre-wrap break-words">
                  {draft.harness.description}
                </p>
                {draft.harness.code && (
                  <pre className="bg-muted mt-3 max-h-48 max-w-full overflow-auto rounded-md p-3 font-mono text-[11px] leading-relaxed">
                    <code>{draft.harness.code}</code>
                  </pre>
                )}
              </>
            ) : (
              <Empty>
                The repeatable run script: setup, execute, capture artifacts. Drafted
                after sub-goals are agreed.
              </Empty>
            )}
          </Section>

          {hasEvaluators && (
            <Section icon={<Sparkles className="size-4" />} label="Evaluators">
              <div className="space-y-3 min-w-0">
                {draft.subGoals
                  .filter((sg) => sg.evaluator)
                  .map((sg) => (
                    <div key={sg.id} className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2 min-w-0">
                        <Badge
                          variant={sg.kind === 'quantitative' ? 'default' : 'secondary'}
                          className="shrink-0 text-[10px] uppercase"
                        >
                          {sg.kind}
                        </Badge>
                        <span className="text-xs font-medium break-words min-w-0">
                          {sg.title}
                        </span>
                      </div>
                      <pre className="bg-muted max-h-40 max-w-full overflow-auto rounded-md p-3 font-mono text-[11px] leading-relaxed">
                        <code>{sg.evaluator}</code>
                      </pre>
                    </div>
                  ))}
              </div>
            </Section>
          )}
        </div>
      </ScrollArea>

      <div className="border-t bg-background/80 px-4 py-3 backdrop-blur space-y-3">
        {phase === 'runs' || phase === 'completed' ? (
          <div className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-center text-xs">
            {phase === 'completed'
              ? 'Experiment complete.'
              : 'Runs in progress — see the Runs tab.'}
          </div>
        ) : phase === 'harness' ? (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="max-fails" className="text-xs">
                Max consecutive failed runs before aborting
              </Label>
              <Input
                id="max-fails"
                type="number"
                min={1}
                max={50}
                value={maxFailDraft}
                onChange={(e) => {
                  setMaxFailDraft(e.target.value)
                  const n = Number(e.target.value)
                  if (Number.isInteger(n) && n >= 1 && n <= 50) {
                    onMaxConsecutiveFailuresChange(n)
                  }
                }}
                placeholder="3"
                className="h-8 text-sm"
              />
            </div>
            <Button
              className="w-full gap-2"
              disabled={!canStartRuns || agentPending}
              onClick={() =>
                onStartRuns(Number(maxFailDraft) || 3)
              }
              title={
                canStartRuns
                  ? 'Tell the agent to start the run loop'
                  : 'Wait for the harness + evaluators to be drafted first; set a max-fail limit.'
              }
            >
              <Play className="size-4" />
              Start runs
            </Button>
          </>
        ) : (
          <Button
            className="w-full gap-2"
            disabled={!canGenerate || agentPending}
            onClick={onGenerateHarness}
            title={
              canGenerate
                ? 'Tell the agent to start writing the harness + evaluators'
                : 'Define the goal, sub-goals, and output artifacts first'
            }
          >
            <Rocket className="size-4" />
            Generate harness &amp; evaluators
          </Button>
        )}
      </div>
    </div>
  )
}

function Section({
  icon,
  label,
  right,
  children,
}: {
  icon: React.ReactNode
  label: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="min-w-0 max-w-full">
      <div className="mb-2 flex items-center gap-2 min-w-0">
        <div className="text-muted-foreground shrink-0">{icon}</div>
        <h3 className="truncate text-xs font-semibold tracking-wide uppercase">
          {label}
        </h3>
        {right && <div className="ml-auto shrink-0">{right}</div>}
      </div>
      <div className="min-w-0 max-w-full">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-xs italic">{children}</p>
}

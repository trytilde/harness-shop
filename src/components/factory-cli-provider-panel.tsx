import { useEffect, useState } from 'react'
import {
  BookOpen,
  CheckCircle2,
  ClipboardList,
  FlaskConical,
  KeyRound,
  Play,
  Rocket,
  Route,
  Wrench,
} from 'lucide-react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import type { ExperimentDraft, ExperimentPhase, ProviderHarnessPhase } from '#/lib/types'

const PHASES: Array<{ id: ProviderHarnessPhase; label: string }> = [
  { id: 'discovery', label: 'Discovery' },
  { id: 'plan', label: 'Plan' },
  { id: 'testing', label: 'Testing' },
  { id: 'implementation', label: 'Implementation' },
]

export function FactoryCliProviderPanel({
  experimentId,
  draft,
  agentPending,
  phase,
  maxConsecutiveFailures,
  onGenerateHarness,
  onStartRuns,
  onMaxConsecutiveFailuresChange,
}: {
  experimentId: string
  draft: ExperimentDraft
  agentPending: boolean
  phase: ExperimentPhase
  maxConsecutiveFailures: number | null
  onGenerateHarness: () => void
  onStartRuns: (maxFails: number) => void
  onMaxConsecutiveFailuresChange: (value: number) => void
}) {
  const provider = draft.providerHarness
  const requiredSecrets = draft.requiredSecrets ?? []
  const [maxFailDraft, setMaxFailDraft] = useState<string>(
    maxConsecutiveFailures != null ? String(maxConsecutiveFailures) : '3',
  )

  useEffect(() => {
    if (maxConsecutiveFailures != null) {
      setMaxFailDraft(String(maxConsecutiveFailures))
    }
  }, [maxConsecutiveFailures])

  const hasTestingPlan = Boolean(provider?.testingPlan)
  const canStartImplementation =
    Boolean(provider?.providerId) &&
    hasTestingPlan &&
    (provider?.e2eTests?.length ?? 0) > 0 &&
    requiredSecrets.length > 0
  const canStartRuns = phase === 'harness' && Boolean(provider?.providerId)

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="min-w-0 max-w-full space-y-6 px-4 py-3">
          <Header providerId={provider?.providerId} workBranch={draft.workBranch} />
          <PhaseStepper current={provider?.phase ?? 'discovery'} />

          <ProviderSection
            icon={<BookOpen className="size-4" />}
            title="Discovery"
            status={phaseStatus(provider?.phase, 'discovery')}
          >
            {provider?.providerGoal ? (
              <Field label="Provider goal">{provider.providerGoal}</Field>
            ) : (
              <Empty>Provider goal appears here after discovery is confirmed.</Empty>
            )}
            {provider?.toolGoals && Object.keys(provider.toolGoals).length > 0 && (
              <div className="space-y-2">
                <div className="text-muted-foreground text-[10px] font-semibold uppercase">
                  Tool goals
                </div>
                {Object.entries(provider.toolGoals).map(([toolId, goal]) => (
                  <div key={toolId} className="rounded-md border px-2.5 py-2">
                    <code className="bg-muted rounded px-1 py-0.5 text-[10px]">
                      {toolId}
                    </code>
                    <p className="mt-1 text-xs whitespace-pre-wrap break-words">
                      {goal}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {(provider?.discoveryNotes ?? []).length > 0 && (
              <ListBlock title="Discovery notes" items={provider?.discoveryNotes ?? []} />
            )}
            {(provider?.references ?? []).length > 0 && (
              <div className="space-y-3">
                <div className="text-muted-foreground text-[10px] font-semibold uppercase">
                  References
                </div>
                {(['auth', 'api_usage', 'general'] as const).map((kind) => {
                  const refs = (provider?.references ?? []).filter(
                    (ref) => ref.kind === kind,
                  )
                  if (refs.length === 0) return null
                  return (
                    <div key={kind} className="space-y-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {kind}
                      </Badge>
                      {refs.map((ref) => (
                        <div key={ref.url} className="min-w-0 rounded-md border px-2.5 py-2">
                          <div className="mb-1 flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className="text-[10px]">
                              {ref.source}
                            </Badge>
                            {ref.confirmed && (
                              <Badge className="text-[10px]">confirmed</Badge>
                            )}
                          </div>
                          <p className="text-xs font-medium break-words">
                            {ref.title ?? ref.url}
                          </p>
                          <p className="text-muted-foreground break-all text-[10px]">
                            {ref.url}
                          </p>
                          {ref.summary && (
                            <p className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap break-words">
                              {ref.summary}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </ProviderSection>

          <ProviderSection
            icon={<Route className="size-4" />}
            title="Plan"
            status={phaseStatus(provider?.phase, 'plan')}
          >
            {provider?.providerPlan ? (
              <Field label="Provider implementation">{provider.providerPlan}</Field>
            ) : (
              <Empty>Provider pseudo-code and implementation plan appear here.</Empty>
            )}
            {(provider?.toolPlans ?? []).length > 0 && (
              <div className="space-y-3">
                <div className="text-muted-foreground text-[10px] font-semibold uppercase">
                  Tool plans
                </div>
                {(provider?.toolPlans ?? []).map((tool) => (
                  <div key={tool.toolId} className="min-w-0 rounded-md border px-2.5 py-2">
                    <code className="bg-muted rounded px-1 py-0.5 text-[10px]">
                      {tool.toolId}
                    </code>
                    <p className="mt-1 text-xs whitespace-pre-wrap break-words">
                      {tool.goal}
                    </p>
                    {tool.implementation && (
                      <p className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap break-words">
                        {tool.implementation}
                      </p>
                    )}
                    {tool.inputSchema && (
                      <SchemaBlock title="Input schema" value={tool.inputSchema} />
                    )}
                    {tool.outputSchema && (
                      <SchemaBlock title="Output schema" value={tool.outputSchema} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </ProviderSection>

          <ProviderSection
            icon={<FlaskConical className="size-4" />}
            title="Testing"
            status={phaseStatus(provider?.phase, 'testing')}
          >
            {provider?.testingPlan ? (
              <Field label="Real e2e testing plan">{provider.testingPlan}</Field>
            ) : (
              <Empty>Real e2e specs and required credentials appear here.</Empty>
            )}
            {(provider?.e2eTests ?? []).length > 0 && (
              <div className="space-y-2">
                <div className="text-muted-foreground text-[10px] font-semibold uppercase">
                  E2E tests
                </div>
                {(provider?.e2eTests ?? []).map((test) => (
                  <div key={test.id} className="min-w-0 rounded-md border px-2.5 py-2">
                    <div className="mb-1 flex flex-wrap items-center gap-1">
                      <code className="bg-muted rounded px-1 py-0.5 text-[10px]">
                        {test.id}
                      </code>
                      <Badge variant="secondary" className="text-[10px]">
                        {test.mode}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {test.destructiveRisk} risk
                      </Badge>
                    </div>
                    <p className="text-xs whitespace-pre-wrap break-words">
                      {test.description}
                    </p>
                    <pre className="bg-muted mt-2 max-h-28 max-w-full overflow-auto rounded p-2 font-mono text-[10px] whitespace-pre-wrap break-words">
                      {test.command}
                    </pre>
                    {test.assertions.length > 0 && (
                      <ListBlock title="Assertions" items={test.assertions} />
                    )}
                    {test.cleanup && <Field label="Cleanup">{test.cleanup}</Field>}
                  </div>
                ))}
              </div>
            )}
            {requiredSecrets.length > 0 && (
              <div className="rounded-md border border-dashed px-3 py-2">
                <div className="mb-2 flex items-center gap-2">
                  <KeyRound className="text-muted-foreground size-3.5" />
                  <div className="text-xs font-medium">override_test_secrets.yaml</div>
                </div>
                <div className="mb-3 flex flex-wrap gap-1">
                  {requiredSecrets.map((secret) => (
                    <Badge key={secret.name} variant="secondary" className="text-[10px]">
                      {secret.name}
                    </Badge>
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">
                  Use the Secrets tab to enter or update these values. The form
                  is rendered from the schema the agent persisted with
                  render_override_secrets_form.
                </p>
              </div>
            )}
          </ProviderSection>

          <ProviderSection
            icon={<Wrench className="size-4" />}
            title="Implementation"
            status={phaseStatus(provider?.phase, 'implementation')}
          >
            {(provider?.implementationNotes ?? []).length > 0 ? (
              <ListBlock
                title="Iteration learnings"
                items={provider?.implementationNotes ?? []}
              />
            ) : (
              <Empty>Iteration learnings and next actions appear here once coding starts.</Empty>
            )}
            {provider?.lastFailure && (
              <Field label="Last failure">{provider.lastFailure}</Field>
            )}
            {provider?.nextAction && (
              <Field label="Next action">{provider.nextAction}</Field>
            )}
          </ProviderSection>
        </div>
      </div>

      <div className="border-t bg-background/80 px-4 py-3 backdrop-blur">
        {phase === 'runs' || phase === 'completed' ? (
          <div className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-center text-xs">
            {phase === 'completed'
              ? 'Provider harness complete.'
              : 'Iterative provider runs are active. See the Runs tab.'}
          </div>
        ) : phase === 'harness' ? (
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="factory-max-fails" className="text-xs">
                Max consecutive failed iterations before aborting
              </Label>
              <Input
                id="factory-max-fails"
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
              onClick={() => onStartRuns(Number(maxFailDraft) || 3)}
            >
              <Play className="size-4" />
              Start iterative e2e loop
            </Button>
          </div>
        ) : (
          <Button
            className="w-full gap-2"
            disabled={!canStartImplementation || agentPending}
            onClick={onGenerateHarness}
            title={
              canStartImplementation
                ? 'Start writing provider e2e tests and implementation changes'
                : 'Confirm discovery, plan, testing specs, and required secrets first'
            }
          >
            <Rocket className="size-4" />
            Start provider implementation
          </Button>
        )}
      </div>
    </div>
  )
}

function Header({
  providerId,
  workBranch,
}: {
  providerId?: string
  workBranch?: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Factory CLI</Badge>
        {providerId && <Badge>{providerId}</Badge>}
      </div>
      {workBranch && (
        <div className="text-muted-foreground text-xs">
          Work branch <code className="bg-muted rounded px-1 py-0.5">{workBranch}</code>
        </div>
      )}
    </div>
  )
}

function PhaseStepper({ current }: { current: ProviderHarnessPhase }) {
  const currentIndex = PHASES.findIndex((phase) => phase.id === current)
  return (
    <div className="grid grid-cols-2 gap-2">
      {PHASES.map((phase, index) => (
        <div
          key={phase.id}
          className="flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-xs"
        >
          <CheckCircle2
            className={
              index <= currentIndex
                ? 'size-3.5 shrink-0 text-primary'
                : 'text-muted-foreground size-3.5 shrink-0'
            }
          />
          <span className="truncate">{phase.label}</span>
        </div>
      ))}
    </div>
  )
}

function phaseStatus(
  current: ProviderHarnessPhase | undefined,
  section: ProviderHarnessPhase,
) {
  const currentIndex = PHASES.findIndex((phase) => phase.id === (current ?? 'discovery'))
  const sectionIndex = PHASES.findIndex((phase) => phase.id === section)
  if (sectionIndex < currentIndex) return 'complete'
  if (sectionIndex === currentIndex) return 'active'
  return 'pending'
}

function ProviderSection({
  icon,
  title,
  status,
  children,
}: {
  icon: React.ReactNode
  title: string
  status: string
  children: React.ReactNode
}) {
  return (
    <section className="min-w-0 max-w-full space-y-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="text-muted-foreground shrink-0">{icon}</div>
        <h3 className="truncate text-xs font-semibold tracking-wide uppercase">
          {title}
        </h3>
        <Badge variant={status === 'active' ? 'default' : 'secondary'} className="ml-auto text-[10px]">
          {status}
        </Badge>
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase">
        {label}
      </div>
      <p className="text-xs whitespace-pre-wrap break-words">{children}</p>
    </div>
  )
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-[10px] font-semibold uppercase">
        {title}
      </div>
      <ul className="list-disc space-y-1 pl-4 text-xs">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="whitespace-pre-wrap break-words">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SchemaBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="mt-2">
      <div className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase">
        {title}
      </div>
      <pre className="bg-muted max-h-32 max-w-full overflow-auto rounded p-2 text-[10px] whitespace-pre-wrap break-words">
        {value}
      </pre>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-xs italic">{children}</p>
}

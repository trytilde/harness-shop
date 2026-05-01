import { useEffect, useMemo, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Activity,
  ArrowLeft,
  FileDiff,
  GitBranch,
  Github,
  Loader2,
  MessageSquareText,
  Square,
} from 'lucide-react'

import { ChatPanel } from '#/components/experiment/chat-panel'
import { DiffsTab } from '#/components/experiment/diffs-tab'
import { DraftPanel } from '#/components/experiment/draft-panel'
import { EditableTitle } from '#/components/experiment/editable-title'
import { RunsTab } from '#/components/experiment/runs-tab'
import { SettingsDialog } from '#/components/settings-dialog'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '#/components/ui/resizable'
import { useConnections } from '#/lib/connections'
import { useExperimentChat } from '#/lib/use-experiment-chat'
import { cn } from '#/lib/utils'
import {
  getExperimentByIdFn,
  getExperimentDraftFn,
  updateExperimentTitleFn,
} from '#/server/api/experiments'
import {
  setExperimentPhaseFn,
  setMaxConsecutiveFailuresFn,
} from '#/server/api/runs'
import type { ExperimentDraft, ExperimentPhase } from '#/lib/types'

/** Message sent to the agent when the user clicks "Generate harness & evaluators". */
function HARNESS_PHASE_PROMPT(draft: ExperimentDraft): string {
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

  return `HARNESS PHASE START

Time to implement. The design is locked in:

GOAL
  ${draft.goal}

SUB-GOALS
${subgoalLines || '  (none)'}

OUTPUT ARTIFACTS
${artifactLines || '  (none)'}

METRICS
${metricLines || '  (none)'}

Now do the work:

1. Build a runnable harness in this repo that produces every artifact above
   and emits every metric. Persist via experiment_state.set_harness.
2. For each quantitative sub-goal: write real assertion code that consumes
   the listed artifact(s) and call set_subgoal_evaluator(id, code).
3. For each qualitative sub-goal: write a reviewer prompt; call the same.
4. Modify source files where it cleans up the harness — instrumentation,
   hooks, tunable config — KEEPING IN MIND that hot-path edits for
   observability change the very perf you're measuring. Prefer narrow flags
   or sampling and call out the tradeoff briefly in chat per change.
5. Don't \`git commit\` yet. Leave changes in the working tree so the user
   can review them in the right-hand diff panel.

Stream a short summary in chat after each significant edit (file + reason).`
}

function RUN_PHASE_PROMPT(maxFails: number, experimentId: string): string {
  return `RUN PHASE START

Begin the autonomous run loop. Constraints:
- Branch: experiment/${experimentId}. Create + checkout if it doesn't exist.
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
  remaining issues — if none, set_phase("completed") and stop. If FAILED,
  call list_recent_runs, search the codebase via cocoindex_code, decide on
  the smallest meaningful change, and continue.
- The user can press an emergency Stop button. If you receive an AbortError,
  do not start a new run.

Start now.`
}

export const Route = createFileRoute('/_app/experiments/$experimentId')({
  component: ExperimentPage,
})

type ExperimentMeta = {
  id: string
  repoOrg: string
  repoName: string
  ref: string
  indexId: string | null
  title: string | null
  phase: ExperimentPhase
  maxConsecutiveFailures: number | null
}

function ExperimentPage() {
  const { experimentId } = Route.useParams()
  const navigate = useNavigate()
  const { allConnected } = useConnections()

  const [exp, setExp] = useState<ExperimentMeta | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ExperimentDraft | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tab, setTab] = useState<'chat' | 'runs' | 'diffs'>('chat')

  // Load the experiment row.
  useEffect(() => {
    let cancelled = false
    void getExperimentByIdFn({ data: { experimentId } })
      .then((row) => {
        if (cancelled) return
        if (!row) {
          setLoadError(`No experiment with id ${experimentId}`)
          return
        }
        setExp({
          id: row.id,
          repoOrg: row.repoOrg,
          repoName: row.repoName,
          ref: row.ref,
          indexId: row.indexId,
          title: row.title,
          phase: row.phase,
          maxConsecutiveFailures: row.maxConsecutiveFailures,
        })
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [experimentId])

  const chat = useExperimentChat(experimentId)

  useEffect(() => {
    if (!exp || !allConnected || !chat.historyLoaded) return
    void chat.bootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exp?.id, allConnected, chat.historyLoaded])

  // Refresh the draft + experiment row when the agent finishes work.
  // CRITICAL: depend on `exp?.id` (a string), not `exp` (the object).
  // setExp below creates a new object reference even when values match;
  // depending on `exp` would re-fire this effect after every fetch — which
  // showed up as a server-fn call every ~1 s.
  useEffect(() => {
    if (!exp?.id) return
    const expId = exp.id
    const repoOrg = exp.repoOrg
    const repoName = exp.repoName
    const ref = exp.ref
    let cancelled = false
    void (async () => {
      const [d, row] = await Promise.all([
        getExperimentDraftFn({ data: { experimentId: expId } }),
        getExperimentByIdFn({ data: { experimentId: expId } }),
      ])
      if (cancelled) return
      if (d) {
        setDraft({
          repo: { org: repoOrg, name: repoName },
          ref: { kind: 'branch', branch: ref },
          goal: d.goal,
          subGoals: d.subGoals,
          artifacts: d.artifacts,
          metrics: d.metrics,
          harness: d.harness,
        })
      }
      if (row) {
        setExp((prev) => {
          if (!prev) return prev
          // Only return a new ref when something actually changed —
          // otherwise React still sees a setState call but bails on
          // re-render, and we definitely don't want to re-trigger this
          // effect via reference change.
          if (
            prev.phase === row.phase &&
            prev.maxConsecutiveFailures === row.maxConsecutiveFailures &&
            prev.title === row.title
          ) {
            return prev
          }
          return {
            ...prev,
            phase: row.phase,
            maxConsecutiveFailures: row.maxConsecutiveFailures,
            title: row.title,
          }
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    exp?.id,
    exp?.repoOrg,
    exp?.repoName,
    exp?.ref,
    chat.toolCompletionTick,
    chat.pending,
  ])

  const isRunPhase = useMemo(
    () => exp?.phase === 'runs' || exp?.phase === 'completed',
    [exp?.phase],
  )

  if (loadError) {
    return (
      <div className="mx-auto max-w-xl py-12">
        <Alert variant="destructive">
          <AlertTitle>Couldn't load experiment</AlertTitle>
          <AlertDescription className="text-xs">{loadError}</AlertDescription>
        </Alert>
        <Button asChild className="mt-4" variant="outline">
          <Link to="/">Back to experiments</Link>
        </Button>
      </div>
    )
  }

  if (!exp || !draft) {
    return (
      <div className="text-muted-foreground flex h-[60vh] items-center justify-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading experiment…
      </div>
    )
  }

  if (!allConnected) {
    return (
      <>
        <div className="mx-auto max-w-2xl py-12 text-center">
          <h1 className="text-xl font-semibold">Finish connecting first</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            You need GitHub and OpenAI Codex linked before designing an
            experiment.
          </p>
          <Button className="mt-4" onClick={() => setSettingsOpen(true)}>
            Open connections
          </Button>
        </div>
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </>
    )
  }

  const onGenerateHarness = async () => {
    await setExperimentPhaseFn({
      data: { experimentId: exp.id, phase: 'harness' },
    })
    setExp((prev) => (prev ? { ...prev, phase: 'harness' } : prev))
    void chat.sendMessage(HARNESS_PHASE_PROMPT(draft))
  }

  const onStartRuns = async (maxFails: number) => {
    await setMaxConsecutiveFailuresFn({
      data: { experimentId: exp.id, maxConsecutiveFailures: maxFails },
    })
    await setExperimentPhaseFn({
      data: { experimentId: exp.id, phase: 'runs' },
    })
    setExp((prev) =>
      prev
        ? { ...prev, phase: 'runs', maxConsecutiveFailures: maxFails }
        : prev,
    )
    setTab('runs')
    void chat.sendMessage(RUN_PHASE_PROMPT(maxFails, exp.id))
  }

  const onMaxConsecutiveFailuresChange = async (value: number) => {
    await setMaxConsecutiveFailuresFn({
      data: { experimentId: exp.id, maxConsecutiveFailures: value },
    })
    setExp((prev) =>
      prev ? { ...prev, maxConsecutiveFailures: value } : prev,
    )
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/' })}
          className="gap-1"
        >
          <ArrowLeft className="size-4" />
          Experiments
        </Button>

        <EditableTitle
          value={exp.title}
          placeholder="Untitled experiment"
          onSave={async (next) => {
            await updateExperimentTitleFn({
              data: { experimentId: exp.id, title: next },
            })
            setExp((prev) => (prev ? { ...prev, title: next } : prev))
          }}
        />

        <div className="bg-muted/50 flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs">
          <Github className="size-3.5" />
          <span className="text-muted-foreground">{exp.repoOrg}/</span>
          <span className="font-medium">{exp.repoName}</span>
          <span className="text-muted-foreground/60">·</span>
          <GitBranch className="size-3" />
          <span className="font-mono">{exp.ref}</span>
        </div>

        <TabSwitcher tab={tab} onTab={setTab} />

        {chat.pending && isRunPhase && (
          <Button
            variant="destructive"
            size="sm"
            className="ml-auto gap-1"
            onClick={() => void chat.cancel()}
          >
            <Square className="size-3.5 fill-current" />
            Stop runs
          </Button>
        )}
      </div>

      {tab === 'chat' ? (
        <ResizablePanelGroup
          orientation="horizontal"
          id="experiment-split"
          className="min-h-0 min-w-0 w-full flex-1"
        >
          <ResizablePanel
            defaultSize={60}
            minSize={35}
            className="min-w-0 overflow-hidden"
          >
            <ChatPanel
              messages={chat.messages}
              onSend={chat.sendMessage}
              onStop={chat.cancel}
              pending={chat.pending}
            />
          </ResizablePanel>
          <ResizableHandle withHandle className="mx-1" />
          <ResizablePanel
            defaultSize={40}
            minSize={25}
            className="min-w-0 overflow-hidden"
          >
            <DraftPanel
              draft={draft}
              agentPending={chat.pending}
              phase={exp.phase}
              maxConsecutiveFailures={exp.maxConsecutiveFailures}
              onGenerateHarness={onGenerateHarness}
              onStartRuns={onStartRuns}
              onMaxConsecutiveFailuresChange={onMaxConsecutiveFailuresChange}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : tab === 'runs' ? (
        <RunsTab
          experimentId={exp.id}
          refreshTick={chat.toolCompletionTick}
          agentPending={chat.pending}
        />
      ) : (
        <DiffsTab experimentId={exp.id} />
      )}

      {chat.error && (
        <div className="text-destructive text-xs">{chat.error}</div>
      )}
    </div>
  )
}

type TabId = 'chat' | 'runs' | 'diffs'

function TabSwitcher({
  tab,
  onTab,
}: {
  tab: TabId
  onTab: (next: TabId) => void
}) {
  const Item = ({
    id,
    label,
    icon: Icon,
  }: {
    id: TabId
    label: string
    icon: React.ComponentType<{ className?: string }>
  }) => (
    <button
      type="button"
      onClick={() => onTab(id)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition',
        tab === id
          ? 'border-primary bg-primary/10 text-foreground'
          : 'text-muted-foreground hover:bg-muted/50',
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
  return (
    <div className="flex items-center gap-1">
      <Item id="chat" label="Chat" icon={MessageSquareText} />
      <Item id="runs" label="Runs" icon={Activity} />
      <Item id="diffs" label="Diffs" icon={FileDiff} />
    </div>
  )
}

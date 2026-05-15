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
import { FactoryCliProviderPanel } from '#/components/factory-cli-provider-panel'
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
import { getHarnessDefinition } from '#/lib/harness-definitions'
import {
  buildHarnessPhasePrompt,
  buildRunPhasePrompt,
} from '#/lib/harness-prompts'

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
  harnessId: string
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
          harnessId: row.harnessId,
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
          harnessId: d.harnessId,
          workBranch: d.workBranch,
          providerHarness: d.providerHarness,
          goal: d.goal,
          infoBlocks: d.infoBlocks,
          requiredSecrets: d.requiredSecrets,
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
            prev.title === row.title &&
            prev.harnessId === row.harnessId
          ) {
            return prev
          }
          return {
            ...prev,
            phase: row.phase,
            maxConsecutiveFailures: row.maxConsecutiveFailures,
            title: row.title,
            harnessId: row.harnessId,
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
  const isFactoryProviderHarness = exp?.harnessId === 'factory-cli-provider'

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
    void chat.sendMessage(
      buildHarnessPhasePrompt(draft, getHarnessDefinition(exp.harnessId)),
    )
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
    void chat.sendMessage(
      buildRunPhasePrompt(
        maxFails,
        exp.id,
        getHarnessDefinition(exp.harnessId),
        draft.workBranch,
      ),
    )
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
              exportFilename={`harness-${exp.id}-chat`}
              exportContext={{
                experimentId: exp.id,
                title: exp.title,
                repo: `${exp.repoOrg}/${exp.repoName}`,
                ref: exp.ref,
                draft,
              }}
            />
          </ResizablePanel>
          <ResizableHandle withHandle className="mx-1" />
          <ResizablePanel
            defaultSize={40}
            minSize={25}
            className="min-w-0 overflow-hidden"
          >
            {isFactoryProviderHarness ? (
              <FactoryCliProviderPanel
                experimentId={exp.id}
                draft={draft}
                agentPending={chat.pending}
                phase={exp.phase}
                maxConsecutiveFailures={exp.maxConsecutiveFailures}
                onGenerateHarness={onGenerateHarness}
                onStartRuns={onStartRuns}
                onMaxConsecutiveFailuresChange={onMaxConsecutiveFailuresChange}
              />
            ) : (
              <DraftPanel
                experimentId={exp.id}
                draft={draft}
                agentPending={chat.pending}
                phase={exp.phase}
                maxConsecutiveFailures={exp.maxConsecutiveFailures}
                onGenerateHarness={onGenerateHarness}
                onStartRuns={onStartRuns}
                onMaxConsecutiveFailuresChange={onMaxConsecutiveFailuresChange}
              />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : tab === 'runs' ? (
        <RunsTab
          experimentId={exp.id}
          harnessId={exp.harnessId}
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

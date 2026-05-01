import { useEffect, useRef, useState } from 'react'
import { Beaker, CheckCircle2, GitBranch, Github, Loader2, XCircle } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { cn } from '#/lib/utils'

type Phase =
  | 'queued'
  | 'cloning'
  | 'cloned'
  | 'initializing'
  | 'indexing'
  | 'ready'
  | 'failed'

const PHASE_LABEL: Record<Phase, string> = {
  queued: 'Queued',
  cloning: 'Cloning repository',
  cloned: 'Clone complete',
  initializing: 'Initializing index',
  indexing: 'Indexing codebase',
  ready: 'Index ready',
  failed: 'Failed',
}

type Progress = {
  filesListed?: number
  added?: number
  unchanged?: number
  reprocessed?: number
}

export function IndexProgressDialog({
  open,
  jobId,
  repoLabel,
  onDone,
  onCancel,
}: {
  open: boolean
  jobId: string | null
  repoLabel: { org: string; name: string; ref: string }
  onDone: () => void
  onCancel: () => void
}) {
  const [phase, setPhase] = useState<Phase>('queued')
  const [progress, setProgress] = useState<Progress>({})
  const [recentLine, setRecentLine] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<{ files?: number; chunks?: number } | null>(null)
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!open || !jobId) return
    setPhase('queued')
    setProgress({})
    setRecentLine('')
    setError(null)
    setStats(null)

    const es = new EventSource(`/api/index-stream/${jobId}`)
    sourceRef.current = es

    es.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data)
        if (ev.type === 'phase') {
          setPhase(ev.phase as Phase)
        } else if (ev.type === 'progress') {
          setPhase('indexing')
          setProgress({
            filesListed: ev.filesListed,
            added: ev.added,
            unchanged: ev.unchanged,
            reprocessed: ev.reprocessed,
          })
        } else if (ev.type === 'log') {
          setRecentLine(ev.line)
        } else if (ev.type === 'done') {
          setPhase('ready')
          setStats({ files: ev.filesCount, chunks: ev.chunksCount })
          es.close()
          onDone()
        } else if (ev.type === 'error') {
          setPhase('failed')
          setError(ev.message)
          es.close()
        }
      } catch {}
    }
    es.onerror = () => {
      // Connection drops are normal at end-of-stream — don't surface as a hard error.
    }
    return () => {
      es.close()
      sourceRef.current = null
    }
  }, [open, jobId])

  const pct = computePct(phase, progress)

  const isTerminal = phase === 'failed' || phase === 'ready'

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Lock modal during indexing — user can only exit via failure (Close)
        // or success (auto-redirect via onDone).
        if (!o && phase === 'failed') onCancel()
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={isTerminal}
        onEscapeKeyDown={(e) => {
          if (!isTerminal) e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          if (!isTerminal) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (!isTerminal) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Beaker className="size-5" /> Indexing codebase
          </DialogTitle>
          <DialogDescription>
            Building a semantic index so the agent can reason about the code.
            Re-used across experiments at the same commit.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted/40 flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
          <Github className="size-3.5 shrink-0" />
          <span className="text-muted-foreground">{repoLabel.org}/</span>
          <span className="font-medium">{repoLabel.name}</span>
          <span className="text-muted-foreground/60">·</span>
          <GitBranch className="size-3" />
          <span className="font-mono">{repoLabel.ref}</span>
        </div>

        <div className="space-y-3 py-1">
          <div className="flex items-center gap-2 text-sm">
            {phase === 'failed' ? (
              <XCircle className="size-4 text-rose-500" />
            ) : phase === 'ready' ? (
              <CheckCircle2 className="size-4 text-emerald-500" />
            ) : (
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            )}
            <span className="font-medium">{PHASE_LABEL[phase]}</span>
            {progress.filesListed !== undefined && (
              <span className="text-muted-foreground ml-auto text-xs">
                {progress.added ?? 0} added · {progress.unchanged ?? 0} unchanged
                {progress.reprocessed
                  ? ` · ${progress.reprocessed} reprocessed`
                  : ''}{' '}
                of {progress.filesListed}
              </span>
            )}
          </div>

          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div
              className={cn(
                'h-full transition-all',
                phase === 'failed'
                  ? 'bg-rose-500'
                  : phase === 'ready'
                    ? 'bg-emerald-500'
                    : 'bg-primary',
              )}
              style={{ width: `${pct}%` }}
            />
          </div>

          {recentLine && phase !== 'ready' && phase !== 'failed' && (
            <div className="text-muted-foreground line-clamp-1 font-mono text-[11px]">
              {recentLine}
            </div>
          )}

          {phase === 'ready' && stats && (
            <div className="text-muted-foreground text-xs">
              {stats.chunks ?? '?'} chunks across {stats.files ?? '?'} files indexed.
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Indexing failed</AlertTitle>
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}
        </div>

        {phase === 'failed' && (
          <DialogFooter>
            <Button variant="outline" onClick={onCancel}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function computePct(phase: Phase, progress: Progress): number {
  if (phase === 'queued') return 4
  if (phase === 'cloning') return 12
  if (phase === 'cloned') return 22
  if (phase === 'initializing') return 30
  if (phase === 'indexing') {
    const total = progress.filesListed ?? 0
    if (!total) return 40
    const handled =
      (progress.added ?? 0) +
      (progress.unchanged ?? 0) +
      (progress.reprocessed ?? 0)
    return 40 + Math.min(55, Math.round((handled / total) * 55))
  }
  if (phase === 'ready') return 100
  if (phase === 'failed') return 100
  return 0
}

import { cn } from '#/lib/utils'
import type { ExperimentStatus } from '#/lib/types'

const STATUS_CONFIG: Record<
  ExperimentStatus,
  { label: string; tone: string; pulse: boolean }
> = {
  running: {
    label: 'Running',
    tone: 'text-sky-600 bg-sky-500/10 ring-sky-500/30 dark:text-sky-300',
    pulse: true,
  },
  finished: {
    label: 'Finished',
    tone: 'text-emerald-600 bg-emerald-500/10 ring-emerald-500/30 dark:text-emerald-300',
    pulse: false,
  },
  failed: {
    label: 'Failed',
    tone: 'text-rose-600 bg-rose-500/10 ring-rose-500/30 dark:text-rose-300',
    pulse: false,
  },
  requires_input: {
    label: 'Requires input',
    tone: 'text-amber-600 bg-amber-500/10 ring-amber-500/30 dark:text-amber-300',
    pulse: true,
  },
  draft: {
    label: 'Draft',
    tone: 'text-muted-foreground bg-muted/50 ring-border',
    pulse: false,
  },
}

export function StatusBadge({ status }: { status: ExperimentStatus }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        cfg.tone,
      )}
    >
      <span className="relative inline-flex h-1.5 w-1.5">
        <span
          aria-hidden
          className={cn(
            'absolute inline-flex h-full w-full rounded-full bg-current opacity-70',
            cfg.pulse && 'animate-ping',
          )}
        />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      {cfg.label}
    </span>
  )
}

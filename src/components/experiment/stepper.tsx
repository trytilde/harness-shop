import { Check } from 'lucide-react'

import { cn } from '#/lib/utils'

export type Stage = 'goal' | 'subgoals' | 'harness' | 'evaluators' | 'confirm'

const STAGES: { id: Stage; label: string; description: string }[] = [
  { id: 'goal', label: 'Goal', description: 'Frame the problem' },
  { id: 'subgoals', label: 'Sub-goals', description: 'Quant + qual' },
  { id: 'harness', label: 'Harness', description: 'How to run it' },
  { id: 'evaluators', label: 'Evaluators', description: 'Code + prompts' },
  { id: 'confirm', label: 'Confirm', description: 'Review & launch' },
]

export function ExperimentStepper({ current }: { current: Stage }) {
  const currentIdx = STAGES.findIndex((s) => s.id === current)
  return (
    <ol className="flex w-full items-center gap-2">
      {STAGES.map((s, i) => {
        const done = i < currentIdx
        const active = i === currentIdx
        return (
          <li key={s.id} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                done && 'bg-primary text-primary-foreground border-primary',
                active && 'border-primary text-primary',
                !done && !active && 'text-muted-foreground border-border',
              )}
            >
              {done ? <Check className="size-3.5" /> : i + 1}
            </div>
            <div className="hidden min-w-0 flex-1 sm:block">
              <div
                className={cn(
                  'truncate text-xs font-medium',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {s.label}
              </div>
              <div className="text-muted-foreground truncate text-[10px]">
                {s.description}
              </div>
            </div>
            {i < STAGES.length - 1 && (
              <div
                className={cn(
                  'h-px flex-1 bg-border',
                  done && 'bg-primary',
                )}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

export const STAGE_ORDER: Stage[] = STAGES.map((s) => s.id)

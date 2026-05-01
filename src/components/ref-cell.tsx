import { GitBranch, GitCommit, GitPullRequest } from 'lucide-react'

import type { ExperimentRef } from '#/lib/types'

export function RefCell({ refData }: { refData: ExperimentRef }) {
  if (refData.kind === 'pr') {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-muted-foreground inline-flex items-center gap-1.5">
          <GitPullRequest className="size-3.5" />#{refData.number}
        </span>
        {refData.branch && (
          <span className="text-muted-foreground/80 inline-flex items-center gap-1 font-mono text-xs">
            <GitBranch className="size-3" />
            {refData.branch}
          </span>
        )}
        {refData.commit && (
          <code className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]">
            {refData.commit.slice(0, 7)}
          </code>
        )}
      </div>
    )
  }

  if (refData.kind === 'commit') {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-muted-foreground inline-flex items-center gap-1">
          <GitCommit className="size-3.5" />
          <code className="font-mono text-xs">{refData.commit.slice(0, 7)}</code>
        </span>
        {refData.branch && (
          <span className="text-muted-foreground/80 inline-flex items-center gap-1 font-mono text-xs">
            <GitBranch className="size-3" />
            {refData.branch}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="text-muted-foreground inline-flex items-center gap-1">
        <GitBranch className="size-3.5" />
        <span className="font-mono text-xs">{refData.branch}</span>
      </span>
      {refData.commit && (
        <code className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]">
          {refData.commit.slice(0, 7)}
        </code>
      )}
    </div>
  )
}

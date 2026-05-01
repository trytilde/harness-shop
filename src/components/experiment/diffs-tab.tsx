import { memo, useEffect, useState } from 'react'
import {
  ChevronsDownUp,
  ChevronsUpDown,
  FileDiff,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'
import { useTheme } from 'next-themes'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { ScrollArea } from '#/components/ui/scroll-area'
import {
  getHarnessDiffsFn,
  type HarnessDiffFile,
} from '#/server/api/harness-diffs'
import { cn } from '#/lib/utils'

export function DiffsTab({ experimentId }: { experimentId: string }) {
  const [diffs, setDiffs] = useState<HarnessDiffFile[]>([])
  const [loading, setLoading] = useState(false)
  const [openByPath, setOpenByPath] = useState<Record<string, boolean>>({})
  const [allOpen, setAllOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<number | null>(null)

  const fetchDiffs = async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await getHarnessDiffsFn({ data: { experimentId } })
      setDiffs(rows)
      setLastFetched(Date.now())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // Fetch once on mount / when experiment changes — never on a timer.
  useEffect(() => {
    void fetchDiffs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experimentId])

  const toggleAll = () => {
    const next = !allOpen
    setAllOpen(next)
    const out: Record<string, boolean> = {}
    for (const d of diffs) out[d.path] = next
    setOpenByPath(out)
  }

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        <FileDiff className="size-4" />
        <span className="font-semibold">Working-tree diffs</span>
        {diffs.length > 0 && (
          <Badge variant="secondary">{diffs.length} file{diffs.length === 1 ? '' : 's'}</Badge>
        )}
        {lastFetched && (
          <span className="text-muted-foreground">
            updated {formatRelative(lastFetched)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {diffs.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={toggleAll}
            >
              {allOpen ? (
                <ChevronsDownUp className="size-3.5" />
              ) : (
                <ChevronsUpDown className="size-3.5" />
              )}
              {allOpen ? 'Collapse all' : 'Expand all'}
            </Button>
          )}
          <Button
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => void fetchDiffs()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div className="space-y-3 p-3">
          {loading && diffs.length === 0 && (
            <div className="text-muted-foreground flex items-center gap-2 px-1 py-8 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Reading working tree…
            </div>
          )}

          {error && (
            <div className="text-rose-600 dark:text-rose-300 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs">
              {error}
            </div>
          )}

          {!loading && !error && diffs.length === 0 && (
            <div className="text-muted-foreground rounded-md border border-dashed py-12 text-center text-sm">
              No working-tree changes. Once the agent edits files in the
              cloned repo, they'll show up here.
            </div>
          )}

          {diffs.map((file) => (
            <DiffCard
              key={file.path}
              file={file}
              open={openByPath[file.path] ?? allOpen}
              onToggle={() =>
                setOpenByPath((prev) => ({
                  ...prev,
                  [file.path]: !(prev[file.path] ?? allOpen),
                }))
              }
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

const DiffCard = memo(function DiffCard({
  file,
  open,
  onToggle,
}: {
  file: HarnessDiffFile
  open: boolean
  onToggle: () => void
}) {
  const { resolvedTheme } = useTheme()
  const useDarkTheme = resolvedTheme === 'dark'

  return (
    <div className="bg-card max-w-full overflow-hidden rounded-md border min-w-0">
      <button
        type="button"
        onClick={onToggle}
        className="hover:bg-muted/50 flex w-full min-w-0 items-center gap-2 border-b px-3 py-2 text-left text-sm"
      >
        <FileDiff className="size-3.5 shrink-0" />
        <code className="min-w-0 flex-1 truncate font-mono">{file.path}</code>
        <Badge
          variant="secondary"
          className={cn(
            'shrink-0 text-[10px] uppercase',
            file.status === 'added' &&
              'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
            file.status === 'deleted' &&
              'bg-rose-500/10 text-rose-700 dark:text-rose-300',
          )}
        >
          {file.status}
        </Badge>
        {open ? (
          <ChevronsDownUp className="size-4 shrink-0 opacity-60" />
        ) : (
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
        )}
      </button>
      {open && (
        <div className="max-w-full overflow-x-auto text-[12px]">
          <ReactDiffViewer
            oldValue={file.oldContent}
            newValue={file.newContent}
            splitView
            compareMethod={DiffMethod.LINES}
            useDarkTheme={useDarkTheme}
            hideLineNumbers={false}
            styles={{
              contentText: {
                fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
                fontSize: 12,
                whiteSpace: 'pre',
              },
              line: { padding: '2px 8px' },
            }}
          />
        </div>
      )}
    </div>
  )
})

function formatRelative(ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  return `${hr}h ago`
}

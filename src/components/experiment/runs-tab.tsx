import { useEffect, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ScrollArea } from '#/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { cn } from '#/lib/utils'
import {
  listRunMetricsFn,
  listRunsFn,
  type RunMetricRow,
} from '#/server/api/runs'
import type { ExperimentRun, RunStatus } from '#/lib/types'

const STATUS_TONE: Record<RunStatus, string> = {
  pending: 'text-muted-foreground bg-muted ring-border',
  running: 'text-sky-600 bg-sky-500/10 ring-sky-500/30 dark:text-sky-300',
  passed:
    'text-emerald-600 bg-emerald-500/10 ring-emerald-500/30 dark:text-emerald-300',
  failed: 'text-rose-600 bg-rose-500/10 ring-rose-500/30 dark:text-rose-300',
  cancelled:
    'text-amber-600 bg-amber-500/10 ring-amber-500/30 dark:text-amber-300',
}

export function RunsTab({
  experimentId,
  refreshTick,
  agentPending,
}: {
  experimentId: string
  refreshTick: number
  agentPending: boolean
}) {
  const [runs, setRuns] = useState<ExperimentRun[]>([])
  const [metrics, setMetrics] = useState<RunMetricRow[]>([])

  useEffect(() => {
    let cancelled = false
    const fetchAll = async () => {
      try {
        const [r, m] = await Promise.all([
          listRunsFn({ data: { experimentId } }),
          listRunMetricsFn({ data: { experimentId } }),
        ])
        if (cancelled) return
        setRuns(r)
        setMetrics(m)
      } catch {
        /* ignore */
      }
    }
    void fetchAll()
    let iv: ReturnType<typeof setInterval> | undefined
    if (agentPending) iv = setInterval(fetchAll, 3000)
    return () => {
      cancelled = true
      if (iv) clearInterval(iv)
    }
  }, [experimentId, refreshTick, agentPending])

  return (
    <ScrollArea className="h-full w-full min-h-0 min-w-0">
      <div className="space-y-6 px-1 py-1 min-w-0">
        <RunsTable runs={runs} />
        <MetricsCharts runs={runs} metrics={metrics} />
      </div>
    </ScrollArea>
  )
}

function RunsTable({ runs }: { runs: ExperimentRun[] }) {
  if (runs.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed py-12 text-center text-sm">
        No runs yet. Hit <strong>Start runs</strong> in the Chat tab.
      </div>
    )
  }
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[64px]">#</TableHead>
            <TableHead>Title</TableHead>
            <TableHead className="w-[120px]">Sub-goals</TableHead>
            <TableHead className="w-[120px]">Evaluators</TableHead>
            <TableHead className="w-[120px]">Tag</TableHead>
            <TableHead className="w-[140px] text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs">{r.runNumber}</TableCell>
              <TableCell className="align-top">
                <div className="font-medium">{r.title ?? `Run ${r.runNumber}`}</div>
                {r.summary && (
                  <p className="text-muted-foreground line-clamp-2 text-xs">
                    {r.summary}
                  </p>
                )}
                {r.errorMessage && (
                  <p className="text-rose-600 dark:text-rose-300 line-clamp-2 text-xs">
                    {r.errorMessage}
                  </p>
                )}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {r.subgoalsPassed}/{r.subgoalsTotal}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {r.evaluatorsPassed}/{r.evaluatorsTotal}
              </TableCell>
              <TableCell className="font-mono text-[11px]">
                {r.tag ?? '—'}
              </TableCell>
              <TableCell className="text-right">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                    STATUS_TONE[r.status],
                  )}
                >
                  {r.status === 'running' && (
                    <span className="bg-current size-1.5 animate-pulse rounded-full" />
                  )}
                  {r.status}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function MetricsCharts({
  runs,
  metrics,
}: {
  runs: ExperimentRun[]
  metrics: RunMetricRow[]
}) {
  if (metrics.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed py-10 text-center text-xs">
        Metric graphs will appear here as runs record values.
      </div>
    )
  }
  // Map run number → run status for dot colour.
  const statusByRun = new Map<number, RunStatus>(
    runs.map((r) => [r.runNumber, r.status]),
  )
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {metrics.map((m) => (
        <MetricChart key={m.metricId} metric={m} statusByRun={statusByRun} />
      ))}
    </div>
  )
}

function MetricChart({
  metric,
  statusByRun,
}: {
  metric: RunMetricRow
  statusByRun: Map<number, RunStatus>
}) {
  const data = metric.series.map((p) => {
    const status = statusByRun.get(p.runNumber)
    const color =
      p.passed === false || status === 'failed'
        ? '#e11d48' // rose-600
        : '#10b981' // emerald-500
    return {
      runNumber: p.runNumber,
      value: p.value,
      color,
    }
  })
  return (
    <div className="bg-card rounded-lg border p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <h4 className="text-sm font-semibold">{metric.metricName}</h4>
        {metric.unit && (
          <span className="text-muted-foreground text-[11px]">
            ({metric.unit})
          </span>
        )}
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis
              dataKey="runNumber"
              tick={{ fontSize: 10 }}
              label={{
                value: 'run',
                position: 'insideBottomRight',
                offset: -2,
                fontSize: 10,
              }}
            />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="value"
              stroke="currentColor"
              strokeWidth={1.5}
              dot={(props: {
                cx?: number
                cy?: number
                payload?: { color?: string }
              }) => {
                const cx = props.cx ?? 0
                const cy = props.cy ?? 0
                const color = props.payload?.color ?? '#10b981'
                return (
                  <circle
                    key={`${cx}-${cy}`}
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill={color}
                    stroke="white"
                    strokeWidth={1}
                  />
                )
              }}
              isAnimationActive={false}
            />
            <Scatter dataKey="value" fill="currentColor" />
            <ReferenceLine y={0} stroke="transparent" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { ConnectGate } from '#/components/connect-gate'
import { CreateExperimentDialog } from '#/components/create-experiment-dialog'
import { ExperimentsTable } from '#/components/experiments-table'
import { useConnections } from '#/lib/connections'
import type { Experiment } from '#/lib/types'
import { listExperimentsFn } from '#/server/api/experiments'

export const Route = createFileRoute('/_app/')({ component: DashboardPage })

function DashboardPage() {
  const { allConnected, loading } = useConnections()
  const [experiments, setExperiments] = useState<Experiment[]>([])

  useEffect(() => {
    if (!allConnected) return
    let cancelled = false
    listExperimentsFn().then((rows) => {
      if (!cancelled) setExperiments(rows)
    })
    return () => {
      cancelled = true
    }
  }, [allConnected])

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Experiments</h1>
          <p className="text-muted-foreground text-sm">
            Define an optimization goal, design a harness, and iterate to a result.
          </p>
        </div>
        <CreateExperimentDialog disabled={!allConnected} />
      </div>

      {loading ? (
        <div className="text-muted-foreground py-12 text-center text-sm">
          Loading…
        </div>
      ) : allConnected ? (
        <ExperimentsTable data={experiments} />
      ) : (
        <ConnectGate />
      )}
    </div>
  )
}

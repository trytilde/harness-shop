import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

import { CreateExperimentDialog } from '#/components/create-experiment-dialog'
import { HarnessRunsTable } from '#/components/harness-runs-table'
import { Button } from '#/components/ui/button'
import {
  DEFAULT_HARNESS_ID,
  getHarnessDefinition,
  type HarnessId,
} from '#/lib/harness-definitions'
import { useConnections } from '#/lib/connections'
import type { Experiment } from '#/lib/types'
import { listHarnessRunsFn } from '#/server/api/experiments'

export const Route = createFileRoute('/_app/harnesses/$harnessId')({
  component: HarnessPage,
})

function HarnessPage() {
  const params = Route.useParams()
  const harness = getHarnessDefinition(params.harnessId)
  const harnessId = harness.id ?? DEFAULT_HARNESS_ID
  const { allConnected } = useConnections()
  const [rows, setRows] = useState<Experiment[]>([])

  useEffect(() => {
    let cancelled = false
    void listHarnessRunsFn({ data: { harnessId } }).then((next) => {
      if (!cancelled) setRows(next)
    })
    return () => {
      cancelled = true
    }
  }, [harnessId])

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <Button asChild variant="ghost" size="sm" className="gap-1 px-0">
            <Link to="/">
              <ArrowLeft className="size-4" />
              Harnesses
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {harness.name}
            </h1>
            <p className="text-muted-foreground text-sm">
              {harness.description}
            </p>
          </div>
        </div>
        <CreateExperimentDialog
          harnessId={harnessId as HarnessId}
          disabled={!allConnected}
        />
      </div>

      <HarnessRunsTable data={rows} harnessId={harnessId as HarnessId} />
    </div>
  )
}


import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { ConnectGate } from '#/components/connect-gate'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Button } from '#/components/ui/button'
import { HARNESS_DEFINITIONS } from '#/lib/harness-definitions'
import { useConnections } from '#/lib/connections'

export const Route = createFileRoute('/_app/')({ component: DashboardPage })

function DashboardPage() {
  const { allConnected, loading } = useConnections()
  const navigate = useNavigate()

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Harness Shop</h1>
          <p className="text-muted-foreground text-sm">
            Pick a structured harness, ground it in a codebase, and iterate to a result.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground py-12 text-center text-sm">
          Loading…
        </div>
      ) : allConnected ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {HARNESS_DEFINITIONS.map((harness) => {
              const Icon = harness.icon
              return (
                <Card key={harness.id} className="rounded-lg">
                  <CardHeader className="space-y-3">
                    <div
                      className={`flex size-10 items-center justify-center rounded-md ${harness.accent}`}
                    >
                      <Icon className="size-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{harness.name}</CardTitle>
                      {harness.requiredRepoHint && (
                        <p className="text-muted-foreground mt-1 text-xs">
                          {harness.requiredRepoHint}
                        </p>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-muted-foreground min-h-16 text-sm">
                      {harness.description}
                    </p>
                    <Button
                      className="w-full"
                      onClick={() =>
                        navigate({
                          to: '/harnesses/$harnessId',
                          params: { harnessId: harness.id },
                        })
                      }
                    >
                      {harness.cta}
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      ) : (
        <ConnectGate />
      )}
    </div>
  )
}

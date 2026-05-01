import { useState } from 'react'
import { ArrowRight, CheckCircle2, Github, Sparkles } from 'lucide-react'

import { CodexSetupDialog } from '#/components/codex-setup-dialog'
import { GithubSetupDialog } from '#/components/github-setup-dialog'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { useConnections } from '#/lib/connections'
import type { ProviderId } from '#/server/api/connections'
import { cn } from '#/lib/utils'

export function ConnectGate() {
  const { state } = useConnections()
  const [openProvider, setOpenProvider] = useState<ProviderId | null>(null)

  return (
    <>
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle className="text-xl">Connect your accounts to continue</CardTitle>
          <CardDescription>
            Harness needs access to GitHub to read your repos and OpenAI Codex to
            power the experiment-design agents.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ConnectionRow
            icon={<Github className="size-5" />}
            title="GitHub"
            description={
              state.github.connected
                ? `Connected as ${state.github.account?.login ?? 'github user'}`
                : 'You\'ll create an OAuth App on GitHub and paste the credentials.'
            }
            connected={state.github.connected}
            actionLabel="Connect GitHub"
            onConnect={() => setOpenProvider('github')}
          />
          <ConnectionRow
            icon={<Sparkles className="size-5" />}
            title="OpenAI Codex"
            description={
              state.codex.connected
                ? `Signed in via ChatGPT (${state.codex.account?.login ?? 'codex user'})`
                : 'Sign in with your ChatGPT account — uses your Codex subscription.'
            }
            connected={state.codex.connected}
            actionLabel="Sign in with ChatGPT"
            onConnect={() => setOpenProvider('codex')}
            disabled={!state.github.connected}
            disabledHint="Connect GitHub first"
          />

          <div className="text-muted-foreground pt-2 text-xs">
            Manage these later via the settings cog in the top-right.
          </div>
        </CardContent>
      </Card>

      <GithubSetupDialog
        open={openProvider === 'github'}
        onOpenChange={(o) => setOpenProvider(o ? 'github' : null)}
      />
      <CodexSetupDialog
        open={openProvider === 'codex'}
        onOpenChange={(o) => setOpenProvider(o ? 'codex' : null)}
      />
    </>
  )
}

function ConnectionRow({
  icon,
  title,
  description,
  connected,
  actionLabel,
  onConnect,
  disabled,
  disabledHint,
}: {
  icon: React.ReactNode
  title: string
  description: string
  connected: boolean
  actionLabel: string
  onConnect: () => void
  disabled?: boolean
  disabledHint?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-lg border p-4',
        connected && 'bg-emerald-500/5 border-emerald-500/20',
      )}
    >
      <div
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-md',
          connected
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          {title}
          {connected && (
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-300" />
          )}
        </div>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      {!connected ? (
        <Button
          size="sm"
          onClick={onConnect}
          disabled={disabled}
          title={disabled ? disabledHint : undefined}
        >
          {actionLabel}
          <ArrowRight className="size-3.5" />
        </Button>
      ) : (
        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-300">
          Connected
        </span>
      )}
    </div>
  )
}

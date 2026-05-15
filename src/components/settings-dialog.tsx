import { useEffect, useState } from 'react'
import { Github, KeyRound, Sparkles, type LucideIcon } from 'lucide-react'

import { CodexSetupDialog } from '#/components/codex-setup-dialog'
import { GithubSetupDialog } from '#/components/github-setup-dialog'
import { OpenaiKeyDialog } from '#/components/openai-key-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { useConnections } from '#/lib/connections'
import { cn } from '#/lib/utils'
import { getEmbeddingsStatusFn } from '#/server/api/embeddings'

type Pane = 'github' | 'codex' | 'openai-key'

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { state, refresh } = useConnections()
  const github = state?.github
  const codex = state?.codex
  const [pane, setPane] = useState<Pane | null>(null)
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false)

  useEffect(() => {
    if (!open) return
    void getEmbeddingsStatusFn().then((s) => setHasOpenaiKey(s.hasApiKey))
  }, [open, pane])

  return (
    <>
      <Dialog open={open && pane === null} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Authentication for the services Harness uses.
            </DialogDescription>
          </DialogHeader>

          <div className="grid w-full min-w-0 gap-2 py-2">
            <Row
              icon={Github}
              title="Configure GitHub"
              subtitle={
                github?.connected
                  ? `Connected as ${github.account?.login ?? 'github user'}`
                  : 'Repository access via OAuth App'
              }
              connected={Boolean(github?.connected)}
              onClick={() => setPane('github')}
            />
            <Row
              icon={Sparkles}
              title="Configure OpenAI subscription"
              subtitle={
                codex?.connected
                  ? `Signed in as ${codex.account?.login ?? 'chatgpt user'}`
                  : 'Sign in with ChatGPT (Codex agents + slow embedding fallback)'
              }
              connected={Boolean(codex?.connected)}
              onClick={() => setPane('codex')}
            />
            <Row
              icon={KeyRound}
              title="Configure OpenAI API key"
              subtitle={
                hasOpenaiKey
                  ? 'API key saved — used for fast embeddings'
                  : 'Optional. Much faster than the ChatGPT subscription for indexing.'
              }
              connected={hasOpenaiKey}
              onClick={() => setPane('openai-key')}
            />
          </div>
        </DialogContent>
      </Dialog>

      <GithubSetupDialog
        open={pane === 'github'}
        onOpenChange={(o) => {
          if (!o) {
            setPane(null)
            void refresh()
          }
        }}
      />
      <CodexSetupDialog
        open={pane === 'codex'}
        onOpenChange={(o) => {
          if (!o) {
            setPane(null)
            void refresh()
          }
        }}
      />
      <OpenaiKeyDialog
        open={pane === 'openai-key'}
        mode="configure"
        onOpenChange={(o) => {
          if (!o) {
            setPane(null)
            void getEmbeddingsStatusFn().then((s) => setHasOpenaiKey(s.hasApiKey))
          }
        }}
      />
    </>
  )
}

function Row({
  icon: Icon,
  title,
  subtitle,
  connected,
  onClick,
}: {
  icon: LucideIcon
  title: string
  subtitle: string
  connected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-muted/60 flex w-full max-w-full min-w-0 items-center gap-3 overflow-hidden rounded-md border px-3 py-2.5 text-left transition"
    >
      <div
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          connected
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
            : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="text-muted-foreground truncate text-xs">{subtitle}</div>
      </div>
      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[10px] ring-1 ring-inset',
          connected
            ? 'text-emerald-600 bg-emerald-500/10 ring-emerald-500/30 dark:text-emerald-300'
            : 'text-muted-foreground bg-muted ring-border',
        )}
      >
        {connected ? 'Connected' : 'Not set'}
      </span>
    </button>
  )
}

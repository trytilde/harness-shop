import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Loader2, Sparkles } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { useConnections } from '#/lib/connections'
import {
  beginCodexOauthFn,
  completeOauthFromUrlFn,
  getOauthFlowStatusFn,
} from '#/server/api/connections'

type Stage = 'intro' | 'waiting' | 'success'

export function CodexSetupDialog({
  open,
  onOpenChange,
  trigger,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const { refresh } = useConnections()
  const setOpen = (o: boolean) => {
    if (!isControlled) setInternalOpen(o)
    onOpenChange?.(o)
    if (!o) void refresh()
  }

  const [stage, setStage] = useState<Stage>('intro')
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const [pendingState, setPendingState] = useState<string | null>(null)
  const [pastedUrl, setPastedUrl] = useState('')
  const [confirming, setConfirming] = useState(false)

  // Reset on open
  useEffect(() => {
    if (!isOpen) return
    setStage('intro')
    setError(null)
    setPendingState(null)
    setPastedUrl('')
  }, [isOpen])

  // Auto-poll while waiting
  const cancelledRef = useRef(false)
  useEffect(() => {
    if (stage !== 'waiting' || !pendingState) return
    cancelledRef.current = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (cancelledRef.current) return
      try {
        const res = await getOauthFlowStatusFn({ data: { state: pendingState } })
        if (cancelledRef.current) return
        if (res.status === 'done') {
          if (res.ok) {
            await refresh()
            setStage('success')
          } else {
            setError(res.message ?? 'Authorization failed.')
            setStage('intro')
          }
          return
        }
      } catch {
        /* keep polling */
      }
      timer = setTimeout(tick, 1300)
    }
    timer = setTimeout(tick, 1300)
    return () => {
      cancelledRef.current = true
      clearTimeout(timer)
    }
  }, [stage, pendingState, refresh])

  const onStart = async () => {
    setError(null)
    setStarting(true)
    try {
      const { authorizeUrl, state } = await beginCodexOauthFn()
      setPendingState(state)
      setPastedUrl('')
      window.open(authorizeUrl, '_blank', 'noopener,noreferrer')
      setStage('waiting')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const onConfirmPasted = async () => {
    if (!pendingState || !pastedUrl.trim()) return
    setError(null)
    setConfirming(true)
    try {
      const res = await completeOauthFromUrlFn({
        data: { state: pendingState, url: pastedUrl.trim() },
      })
      if (res.ok) {
        await refresh()
        setStage('success')
      } else {
        setError(res.message)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5" /> Sign in with ChatGPT
          </DialogTitle>
          <DialogDescription>
            Uses the same OAuth client as the upstream <code>codex</code> CLI. Your
            Codex subscription powers the experiment-design agents.
          </DialogDescription>
        </DialogHeader>

        {stage === 'intro' && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              We'll open auth.openai.com in a new tab. Approve there and we'll
              capture the callback automatically. If your browser can't reach the
              local callback (remote box, blocked port), you can paste the
              redirect URL on the next screen instead.
            </p>

            {error && (
              <Alert variant="destructive">
                <AlertTitle>Couldn't connect</AlertTitle>
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={onStart} disabled={starting}>
                {starting ? <Loader2 className="size-4 animate-spin" /> : null}
                Sign in with ChatGPT
                <ArrowRight className="size-4" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {stage === 'waiting' && (
          <div className="space-y-5">
            <div className="space-y-2 py-2 text-center">
              <Loader2 className="text-muted-foreground mx-auto size-6 animate-spin" />
              <div className="text-sm font-medium">Waiting for ChatGPT callback…</div>
              <p className="text-muted-foreground mx-auto max-w-sm text-xs">
                Approve the request in the new tab. If your callback URL isn't
                reachable from your browser, paste the redirect URL below.
              </p>
            </div>

            <div className="bg-muted/30 space-y-2 rounded-md border p-3">
              <Label htmlFor="codex-paste" className="text-xs">
                Paste redirect URL (fallback)
              </Label>
              <Input
                id="codex-paste"
                value={pastedUrl}
                onChange={(e) => setPastedUrl(e.target.value)}
                placeholder="http://localhost:1455/auth/callback?code=…&state=…"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-muted-foreground text-[11px]">
                Copy the URL from your browser's address bar after ChatGPT redirects
                you. We'll extract <code>code</code> and <code>state</code> from it.
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTitle>Couldn't complete</AlertTitle>
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setStage('intro')
                  setPendingState(null)
                  setPastedUrl('')
                  setError(null)
                }}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={onConfirmPasted}
                disabled={!pastedUrl.trim() || confirming}
              >
                {confirming ? <Loader2 className="size-4 animate-spin" /> : null}
                Confirm
              </Button>
            </DialogFooter>
          </div>
        )}

        {stage === 'success' && (
          <div className="space-y-3 py-6 text-center">
            <div className="bg-emerald-500/10 mx-auto flex size-10 items-center justify-center rounded-full">
              <Check className="size-5 text-emerald-600 dark:text-emerald-300" />
            </div>
            <div className="text-sm font-medium">Codex connected</div>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Copy, ExternalLink, Github, Loader2 } from 'lucide-react'

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
  beginGithubOauthFn,
  completeOauthFromUrlFn,
  getGithubConfigFn,
  getOauthFlowStatusFn,
  saveGithubConfigFn,
} from '#/server/api/connections'

type Stage = 'form' | 'waiting' | 'success'

const DEFAULT_CALLBACK = 'http://localhost:1456/auth/callback'

export function GithubSetupDialog({
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

  const [stage, setStage] = useState<Stage>('form')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [callbackUrl, setCallbackUrl] = useState(DEFAULT_CALLBACK)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // OAuth flow state
  const [pendingState, setPendingState] = useState<string | null>(null)
  const [pastedUrl, setPastedUrl] = useState('')
  const [confirming, setConfirming] = useState(false)

  // Reset on open
  useEffect(() => {
    if (!isOpen) return
    setStage('form')
    setError(null)
    setClientSecret('')
    setPendingState(null)
    setPastedUrl('')
    void getGithubConfigFn().then((cfg) => {
      if (cfg) {
        setClientId(cfg.clientId)
        setCallbackUrl(cfg.callbackUrl)
      } else {
        setCallbackUrl(DEFAULT_CALLBACK)
      }
    })
  }, [isOpen])

  // Auto-poll while waiting. The http listener resolves into the same flow
  // map, so this races the manual paste — first one wins.
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
            setStage('form')
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

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await saveGithubConfigFn({
        data: {
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          callbackUrl: callbackUrl.trim(),
        },
      })
      const { authorizeUrl, state } = await beginGithubOauthFn()
      setPendingState(state)
      setPastedUrl('')
      window.open(authorizeUrl, '_blank', 'noopener,noreferrer')
      setStage('waiting')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="size-5" /> Connect GitHub
          </DialogTitle>
          <DialogDescription>
            Harness uses your own GitHub OAuth App so the consent screen names your
            org. Credentials stay in your local SQLite.
          </DialogDescription>
        </DialogHeader>

        {stage === 'form' && (
          <form onSubmit={onSubmit} className="space-y-4">
            <Instructions callbackUrl={callbackUrl} />
            <div className="grid gap-2">
              <Label htmlFor="gh-client-id">Client ID</Label>
              <Input
                id="gh-client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Iv23li…"
                required
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="gh-client-secret">Client Secret</Label>
              <Input
                id="gh-client-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Generate in your OAuth App"
                required
                autoComplete="off"
              />
              <p className="text-muted-foreground text-xs">
                Stored encrypted in <code>data/harness.db</code>.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="gh-callback">Authorization callback URL</Label>
              <Input
                id="gh-callback"
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                placeholder="http://localhost:1456/auth/callback"
                required
              />
              <p className="text-muted-foreground text-xs">
                Must match what you set in the OAuth App. Override if you're on a
                remote box.
              </p>
            </div>

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
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Save & authorize
                <ArrowRight className="size-4" />
              </Button>
            </DialogFooter>
          </form>
        )}

        {stage === 'waiting' && (
          <div className="space-y-5">
            <div className="space-y-2 py-2 text-center">
              <Loader2 className="text-muted-foreground mx-auto size-6 animate-spin" />
              <div className="text-sm font-medium">Waiting for GitHub callback…</div>
              <p className="text-muted-foreground mx-auto max-w-sm text-xs">
                Approve the request in the new tab. If your callback URL isn't
                reachable from your browser (remote box, blocked port), paste the
                redirect URL below instead.
              </p>
            </div>

            <div className="bg-muted/30 space-y-2 rounded-md border p-3">
              <Label htmlFor="gh-paste" className="text-xs">
                Paste redirect URL (fallback)
              </Label>
              <Input
                id="gh-paste"
                value={pastedUrl}
                onChange={(e) => setPastedUrl(e.target.value)}
                placeholder="http://localhost:1456/auth/callback?code=…&state=…"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-muted-foreground text-[11px]">
                Copy the URL from your browser's address bar after GitHub redirects
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
                  setStage('form')
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
            <div className="text-sm font-medium">GitHub connected</div>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Instructions({ callbackUrl }: { callbackUrl: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return (
    <div className="bg-muted/40 space-y-2 rounded-md border p-3 text-xs">
      <div className="text-foreground font-medium">Create a GitHub OAuth App</div>
      <ol className="text-muted-foreground list-decimal space-y-1 pl-5">
        <li>
          Open{' '}
          <a
            href="https://github.com/settings/developers"
            target="_blank"
            rel="noreferrer"
            className="text-foreground inline-flex items-center gap-0.5 underline"
          >
            github.com/settings/developers
            <ExternalLink className="size-3" />
          </a>{' '}
          (or your org's settings → <em>Developer settings</em>).
        </li>
        <li>
          Click <strong>New OAuth App</strong>.
        </li>
        <li>
          Set <strong>Homepage URL</strong> to{' '}
          <code className="bg-background rounded px-1 py-0.5">http://localhost:3100</code>.
        </li>
        <li>
          Set <strong>Authorization callback URL</strong> to:
          <div className="mt-1 flex items-center gap-1.5">
            <code className="bg-background flex-1 truncate rounded px-1.5 py-0.5">
              {callbackUrl}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={() => copy(callbackUrl)}
            >
              {copied ? (
                <>
                  <Check className="size-3" /> Copied
                </>
              ) : (
                <>
                  <Copy className="size-3" /> Copy
                </>
              )}
            </Button>
          </div>
        </li>
        <li>
          Register, then <strong>Generate a new client secret</strong>. Paste both
          values below.
        </li>
      </ol>
    </div>
  )
}

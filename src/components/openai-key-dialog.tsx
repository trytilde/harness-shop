import { useEffect, useState } from 'react'
import { ArrowRight, Check, ExternalLink, KeyRound, Loader2, Sparkles, Trash2 } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  checkEmbeddingsAccessFn,
  clearOpenaiApiKeyFn,
  getEmbeddingsStatusFn,
  saveOpenaiApiKeyFn,
} from '#/server/api/embeddings'

type Stage = 'probing' | 'enter' | 'saving' | 'success'

export function OpenaiKeyDialog({
  open,
  onOpenChange,
  /** Called after the dialog has confirmed access (saved key or probe ok). */
  onReady,
  /**
   * 'gate' (default): probe Codex first; only ask for a key if it doesn't work.
   * 'configure': go straight to the input form so the user can save/replace
   * the key from Settings even if Codex would have worked.
   */
  mode = 'gate',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onReady?: () => void
  mode?: 'gate' | 'configure'
}) {
  const [stage, setStage] = useState<Stage>('enter')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState(false)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    if (!open) return
    setApiKey('')
    setError(null)
    if (mode === 'gate') {
      setStage('probing')
      void checkEmbeddingsAccessFn().then((probe) => {
        if (probe.ready) {
          onReady?.()
        } else {
          setStage('enter')
          if (probe.reason === 'apikey_invalid') {
            setError(`Saved key was rejected: ${probe.message ?? 'unknown error'}`)
          } else if (probe.reason === 'codex_invalid') {
            setError('Codex sign-in didn\'t grant API access. Provide an OpenAI API key.')
          }
        }
      })
    } else {
      setStage('enter')
      void getEmbeddingsStatusFn().then((s) => setSavedKey(s.hasApiKey))
    }
  }, [open, mode, onReady])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setStage('saving')
    try {
      const res = await saveOpenaiApiKeyFn({ data: { apiKey: apiKey.trim() } })
      if (res.ready) {
        setSavedKey(true)
        if (mode === 'configure') {
          setStage('success')
        } else {
          onReady?.()
        }
      } else {
        setError(res.message ?? 'Key was rejected by OpenAI.')
        setStage('enter')
      }
    } catch (e) {
      setError((e as Error).message)
      setStage('enter')
    }
  }

  const onClear = async () => {
    setClearing(true)
    try {
      await clearOpenaiApiKeyFn()
      setSavedKey(false)
      setApiKey('')
    } finally {
      setClearing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5" /> OpenAI API key
          </DialogTitle>
          <DialogDescription>
            {mode === 'gate'
              ? `Embeddings power the codebase index. We try your ChatGPT/Codex token first; if it doesn't grant API access, paste an OpenAI API key.`
              : `A real API key is much faster than the ChatGPT subscription token (which OpenAI throttles to ~1 request per minute under load).`}
          </DialogDescription>
        </DialogHeader>

        {stage === 'probing' && (
          <div className="space-y-2 py-6 text-center">
            <Loader2 className="text-muted-foreground mx-auto size-6 animate-spin" />
            <div className="text-sm font-medium">Checking access…</div>
            <p className="text-muted-foreground mx-auto max-w-sm text-xs">
              Probing api.openai.com with your Codex sign-in.
            </p>
          </div>
        )}

        {(stage === 'enter' || stage === 'saving') && (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="bg-muted/40 flex items-start gap-2 rounded-md border p-3 text-xs">
              <Sparkles className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
              <div>
                Get one at{' '}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 underline"
                >
                  platform.openai.com/api-keys
                  <ExternalLink className="size-3" />
                </a>
                . We use <code>text-embedding-3-small</code> (~$0.02 / 1 M tokens).
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="openai-key">
                API key
                {savedKey && (
                  <span className="text-muted-foreground ml-2 text-[11px]">
                    (a key is already saved — paste a new one to replace it)
                  </span>
                )}
              </Label>
              <Input
                id="openai-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={savedKey ? '•••••••••• (replace)' : 'sk-…'}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-muted-foreground text-xs">
                Stored encrypted in <code>data/harness.db</code>.
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTitle>Couldn't verify</AlertTitle>
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter className="flex !justify-between gap-2">
              <div>
                {mode === 'configure' && savedKey && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onClear}
                    disabled={clearing}
                    className="text-destructive hover:text-destructive"
                  >
                    {clearing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                    Remove key
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                >
                  {mode === 'gate' ? 'Cancel' : 'Close'}
                </Button>
                <Button
                  type="submit"
                  disabled={stage === 'saving' || !apiKey.trim()}
                >
                  {stage === 'saving' && <Loader2 className="size-4 animate-spin" />}
                  Save & verify
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}

        {stage === 'success' && (
          <div className="space-y-3 py-6 text-center">
            <div className="bg-emerald-500/10 mx-auto flex size-10 items-center justify-center rounded-full">
              <Check className="size-5 text-emerald-600 dark:text-emerald-300" />
            </div>
            <div className="text-sm font-medium">API key saved</div>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

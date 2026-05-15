import { useMemo, useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { RequiredSecret } from '#/lib/types'
import { saveProviderSecretsFn } from '#/server/api/provider-secrets'

export function ProviderSecretsDialog({
  experimentId,
  requiredSecrets,
  disabled,
}: {
  experimentId: string
  requiredSecrets: RequiredSecret[]
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [providerId, setProviderId] = useState('')
  const [file, setFile] = useState<'test_secrets.yaml' | 'override_test_secrets.yaml'>(
    'override_test_secrets.yaml',
  )
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  const missing = useMemo(
    () =>
      requiredSecrets.some(
        (secret) => secret.required !== false && !values[secret.name]?.trim(),
      ) || !providerId.trim(),
    [providerId, requiredSecrets, values],
  )

  const onSave = async () => {
    setError(null)
    setSavedPath(null)
    setSaving(true)
    try {
      const result = await saveProviderSecretsFn({
        data: { experimentId, providerId: providerId.trim(), values, file },
      })
      setSavedPath(result.path)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full gap-2" disabled={disabled}>
          <KeyRound className="size-4" />
          Provider test secrets
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Provider test secrets</DialogTitle>
          <DialogDescription>
            Writes the local provider secrets file in the indexed clone used by
            this harness. These files should be gitignored by CLI Factory.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="provider-id">Provider id</Label>
            <Input
              id="provider-id"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              placeholder="google-workspace"
            />
          </div>
          <div className="grid gap-2">
            <Label>File</Label>
            <Select value={file} onValueChange={(v) => setFile(v as typeof file)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="test_secrets.yaml">test_secrets.yaml</SelectItem>
                <SelectItem value="override_test_secrets.yaml">
                  override_test_secrets.yaml
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {requiredSecrets.map((secret) => (
            <div key={secret.name} className="grid gap-2">
              <Label htmlFor={`secret-${secret.name}`}>
                {secret.name}
                {secret.required === false ? (
                  <span className="text-muted-foreground ml-1 text-xs">
                    optional
                  </span>
                ) : null}
              </Label>
              <Input
                id={`secret-${secret.name}`}
                type="password"
                value={values[secret.name] ?? ''}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [secret.name]: e.target.value,
                  }))
                }
              />
              <p className="text-muted-foreground text-xs">
                {secret.description}
              </p>
            </div>
          ))}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Could not save secrets</AlertTitle>
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}
          {savedPath && (
            <Alert>
              <AlertTitle>Secrets saved</AlertTitle>
              <AlertDescription className="text-xs">{savedPath}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button onClick={onSave} disabled={missing || saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

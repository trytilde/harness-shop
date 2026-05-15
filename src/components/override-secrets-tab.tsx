import { useMemo, useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { JsonSchema, OverrideSecretsFormConfig } from '#/lib/types'
import { saveProviderSecretsFn } from '#/server/api/provider-secrets'

type SecretValue = string | number | boolean

export function OverrideSecretsTab({
  experimentId,
  config,
  disabled,
  onSaved,
}: {
  experimentId: string
  config?: OverrideSecretsFormConfig
  disabled?: boolean
  onSaved?: (path: string) => void
}) {
  const fields = useMemo(() => schemaFields(config?.schema), [config?.schema])
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(
    config?.savedPath ?? null,
  )

  if (!config) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center rounded-lg border border-dashed text-sm">
        The agent has not rendered an override secrets form yet.
      </div>
    )
  }

  const required = new Set(config.schema.required ?? [])
  const missing = fields.some(
    (field) => required.has(field.name) && !String(values[field.name] ?? '').trim(),
  )

  const onSave = async () => {
    setError(null)
    setSavedPath(null)
    setSaving(true)
    try {
      const payload = Object.fromEntries(
        fields
          .filter((field) => String(values[field.name] ?? '').trim().length > 0)
          .map((field) => [field.name, coerceValue(values[field.name] ?? '', field.schema)]),
      )
      const result = await saveProviderSecretsFn({
        data: {
          experimentId,
          providerId: config.providerId,
          file: config.file,
          values: payload,
        },
      })
      setValues({})
      setSavedPath(result.path)
      onSaved?.(result.path)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-5 px-2 py-2">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <KeyRound className="text-muted-foreground size-4" />
              <h2 className="text-sm font-semibold">
                {config.schema.title ?? 'Override secrets'}
              </h2>
            </div>
            <p className="text-muted-foreground text-xs">
              Writes <code>{config.file}</code> for{' '}
              <code>{config.providerId}</code>. Fields are intentionally blank
              after save.
            </p>
            {config.schema.description && (
              <p className="text-muted-foreground text-xs">
                {config.schema.description}
              </p>
            )}
          </div>

          <div className="grid gap-4">
            {fields.map((field) => (
              <SchemaField
                key={field.name}
                name={field.name}
                schema={field.schema}
                required={required.has(field.name)}
                value={values[field.name] ?? ''}
                disabled={disabled || saving}
                onChange={(value) =>
                  setValues((prev) => ({ ...prev, [field.name]: value }))
                }
              />
            ))}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Could not save secrets</AlertTitle>
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}
          {savedPath && (
            <Alert>
              <AlertTitle>Secrets saved</AlertTitle>
              <AlertDescription className="text-xs">
                {savedPath}. Values are hidden; re-enter fields to update them.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>
      <div className="border-t bg-background/80 px-3 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl justify-end">
          <Button onClick={onSave} disabled={disabled || saving || missing}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save override secrets
          </Button>
        </div>
      </div>
    </div>
  )
}

function SchemaField({
  name,
  schema,
  required,
  value,
  disabled,
  onChange,
}: {
  name: string
  schema: JsonSchema
  required: boolean
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const label = schema.title ?? name
  const type = schemaType(schema)
  return (
    <div className="grid gap-2">
      <Label htmlFor={`override-secret-${name}`}>
        {label}
        {!required && (
          <span className="text-muted-foreground ml-1 text-xs">optional</span>
        )}
      </Label>
      {schema.enum && schema.enum.length > 0 ? (
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger id={`override-secret-${name}`}>
            <SelectValue placeholder="Select value" />
          </SelectTrigger>
          <SelectContent>
            {schema.enum.map((option) => (
              <SelectItem key={String(option)} value={String(option)}>
                {String(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={`override-secret-${name}`}
          type={inputType(schema, type)}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={schema.default == null ? undefined : String(schema.default)}
        />
      )}
      {schema.description && (
        <p className="text-muted-foreground text-xs">{schema.description}</p>
      )}
    </div>
  )
}

function schemaFields(schema?: JsonSchema) {
  return Object.entries(schema?.properties ?? {}).map(([name, fieldSchema]) => ({
    name,
    schema: fieldSchema,
  }))
}

function schemaType(schema: JsonSchema) {
  return Array.isArray(schema.type) ? schema.type[0] : schema.type
}

function inputType(schema: JsonSchema, type?: string) {
  if (schema.writeOnly || schema.format === 'password') return 'password'
  if (schema.format === 'email') return 'email'
  if (type === 'number' || type === 'integer') return 'number'
  return 'text'
}

function coerceValue(value: string, schema: JsonSchema): SecretValue {
  const type = schemaType(schema)
  if (type === 'number') return Number(value)
  if (type === 'integer') return Number.parseInt(value, 10)
  if (type === 'boolean') return value === 'true'
  return value
}

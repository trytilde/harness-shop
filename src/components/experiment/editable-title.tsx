import { useEffect, useRef, useState } from 'react'
import { Loader2, Pencil, Save } from 'lucide-react'

import { cn } from '#/lib/utils'

export function EditableTitle({
  value,
  placeholder = 'Untitled experiment',
  onSave,
}: {
  value: string | null
  placeholder?: string
  onSave: (next: string) => Promise<void> | void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(value ?? '')
  }, [value, editing])

  useEffect(() => {
    if (editing) {
      // Focus + select on enter to edit mode.
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing])

  const beginEdit = () => {
    setDraft(value ?? '')
    setEditing(true)
  }

  const commit = async () => {
    const next = draft.trim()
    if (!next || next === (value ?? '').trim()) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(next)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => {
    setDraft(value ?? '')
    setEditing(false)
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
          onBlur={() => void commit()}
          placeholder={placeholder}
          className={cn(
            'bg-transparent border-0 border-b border-dashed border-muted-foreground/60',
            'min-w-0 max-w-[40ch] px-0 py-0 text-sm font-semibold',
            'focus:outline-none focus:border-foreground',
          )}
        />
      ) : (
        <button
          type="button"
          onClick={beginEdit}
          aria-label="Edit experiment title"
          className={cn(
            'min-w-0 truncate text-left text-sm font-semibold',
            'border-b border-dashed border-muted-foreground/40 hover:border-foreground/60',
            value ? '' : 'text-muted-foreground italic',
          )}
        >
          {value && value.trim().length > 0 ? value : placeholder}
        </button>
      )}
      <button
        type="button"
        onClick={editing ? () => void commit() : beginEdit}
        aria-label={editing ? 'Save title' : 'Edit title'}
        className={cn(
          'text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center justify-center rounded-sm p-1 transition',
          saving && 'opacity-60',
        )}
        disabled={saving}
      >
        {saving ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : editing ? (
          <Save className="size-3.5" />
        ) : (
          <Pencil className="size-3.5" />
        )}
      </button>
    </div>
  )
}

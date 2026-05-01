import { useState } from 'react'
import { Check, ChevronsUpDown, GitBranch, ShieldCheck } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { cn } from '#/lib/utils'
import type { Branch } from '#/lib/types'

export function BranchPicker({
  branches,
  value,
  onChange,
  disabled,
}: {
  branches: Branch[]
  value: Branch | null
  onChange: (branch: Branch) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          {value ? (
            <span className="flex min-w-0 items-center gap-2">
              <GitBranch className="size-4 shrink-0" />
              <span className="truncate font-mono text-sm">{value.name}</span>
              <code className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]">
                {value.commit.slice(0, 7)}
              </code>
            </span>
          ) : (
            <span className="text-muted-foreground">
              {disabled ? 'Pick a repository first' : 'Select a branch…'}
            </span>
          )}
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search branches…" />
          <CommandList>
            <CommandEmpty>No branch found.</CommandEmpty>
            <CommandGroup>
              {branches.map((b) => {
                const selected = value?.name === b.name
                return (
                  <CommandItem
                    key={b.name}
                    value={b.name}
                    onSelect={() => {
                      onChange(b)
                      setOpen(false)
                    }}
                    className="flex items-center gap-2"
                  >
                    <GitBranch className="size-4 shrink-0" />
                    <span className="flex-1 truncate font-mono text-sm">{b.name}</span>
                    <code className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]">
                      {b.commit.slice(0, 7)}
                    </code>
                    {b.protected && (
                      <ShieldCheck className="text-muted-foreground size-3.5" />
                    )}
                    <Check
                      className={cn(
                        'size-4 shrink-0',
                        selected ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

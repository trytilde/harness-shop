import { useState } from 'react'
import { Check, ChevronsUpDown, Github, Lock } from 'lucide-react'

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
import type { Repo } from '#/lib/types'

export function RepoPicker({
  repos,
  value,
  onChange,
}: {
  repos: Repo[]
  value: Repo | null
  onChange: (repo: Repo) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {value ? (
            <span className="flex items-center gap-2 truncate">
              <Github className="size-4 shrink-0" />
              <span className="text-muted-foreground">{value.org}/</span>
              <span className="truncate">{value.name}</span>
              {value.private && <Lock className="text-muted-foreground size-3" />}
            </span>
          ) : (
            <span className="text-muted-foreground">Select a repository…</span>
          )}
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search repositories…" />
          <CommandList>
            <CommandEmpty>No repository found.</CommandEmpty>
            <CommandGroup>
              {repos.map((repo) => {
                const slug = `${repo.org}/${repo.name}`
                const selected =
                  value?.org === repo.org && value.name === repo.name
                return (
                  <CommandItem
                    key={slug}
                    value={slug}
                    onSelect={() => {
                      onChange(repo)
                      setOpen(false)
                    }}
                    className="flex items-center gap-2"
                  >
                    <Github className="size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-muted-foreground">{repo.org}/</span>
                        <span className="truncate">{repo.name}</span>
                        {repo.private && (
                          <Lock className="text-muted-foreground size-3 shrink-0" />
                        )}
                      </div>
                      {repo.description && (
                        <p className="text-muted-foreground truncate text-xs">
                          {repo.description}
                        </p>
                      )}
                    </div>
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

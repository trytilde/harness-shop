import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Beaker, Settings as SettingsIcon } from 'lucide-react'

import { ModeToggle } from '#/components/mode-toggle'
import { SettingsDialog } from '#/components/settings-dialog'
import { Button } from '#/components/ui/button'

export function TopBar() {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <header className="bg-background/80 sticky top-0 z-20 flex h-14 items-center gap-4 border-b px-6 backdrop-blur">
      <Link to="/" className="flex items-center gap-2">
        <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
          <Beaker className="size-4" />
        </div>
        <span className="text-sm font-semibold">Harness Shop</span>
      </Link>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          title="Settings"
        >
          <SettingsIcon className="size-4" />
        </Button>
        <ModeToggle />
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </header>
  )
}

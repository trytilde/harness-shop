import { Github } from 'lucide-react'

export function RepoCell({ org, name }: { org: string; name: string }) {
  return (
    <div className="flex items-center gap-2 font-medium">
      <Github className="text-muted-foreground size-4 shrink-0" />
      <span className="text-muted-foreground">{org}</span>
      <span className="text-muted-foreground/60">/</span>
      <span>{name}</span>
    </div>
  )
}

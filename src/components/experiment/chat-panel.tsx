import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, ChevronDown, ChevronRight, Send, Sparkles, Square, Terminal, XCircle } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { ScrollArea } from '#/components/ui/scroll-area'
import { Textarea } from '#/components/ui/textarea'
import type { Part, UIMessage } from '#/lib/use-experiment-chat'
import { cn } from '#/lib/utils'

export function ChatPanel({
  messages,
  onSend,
  onStop,
  pending,
  placeholder = 'Reply…',
}: {
  messages: UIMessage[]
  onSend: (content: string) => void
  onStop?: () => void
  pending?: boolean
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const submit = () => {
    const text = draft.trim()
    if (!text || pending) return
    onSend(text)
    setDraft('')
  }

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden">
      <ScrollArea className="min-h-0 min-w-0 w-full flex-1">
        <div ref={scrollRef} className="space-y-4 px-4 py-3 min-w-0">
          {messages.length === 0 && (
            <div className="text-muted-foreground py-12 text-center text-sm">
              Waking up the agent…
            </div>
          )}
          {messages.map((m) => (
            <Message key={m.id} message={m} />
          ))}
          {pending && (
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <Sparkles className="size-3 animate-pulse" />
              Thinking…
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="px-4 pt-3 pb-2 min-w-0">
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className="min-h-[60px] resize-none min-w-0"
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submit()
              }
            }}
          />
          {pending && onStop ? (
            <Button
              onClick={onStop}
              size="icon"
              variant="destructive"
              title="Stop the agent"
            >
              <Square className="size-4 fill-current" />
              <span className="sr-only">Stop</span>
            </Button>
          ) : (
            <Button onClick={submit} disabled={!draft.trim() || pending} size="icon">
              <Send className="size-4" />
              <span className="sr-only">Send</span>
            </Button>
          )}
        </div>
        <div className="text-muted-foreground mt-1.5 text-[10px]">
          {pending
            ? 'Click stop to cancel the agent'
            : '⌘/Ctrl + Enter to send'}
        </div>
      </div>
    </div>
  )
}

function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end min-w-0">
        <div className="bg-primary text-primary-foreground max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {message.parts
            .map((p) => (p.kind === 'text' ? p.text : ''))
            .join('')}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 text-sm min-w-0">
      {message.parts.length === 0 && (
        <div className="text-muted-foreground text-xs italic">
          Waiting for the agent…
        </div>
      )}
      {message.parts.map((p, i) => (
        <PartView key={i} part={p} />
      ))}
    </div>
  )
}

function PartView({ part }: { part: Part }) {
  if (part.kind === 'text') {
    if (!part.text) return null
    return <MarkdownText text={part.text} />
  }
  return <ToolCallView part={part} />
}

function MarkdownText({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Force code blocks to wrap inside the resizable panel.
          pre: (props) => (
            <pre
              {...props}
              className="bg-muted overflow-x-auto rounded-md p-3 text-[12px] leading-relaxed"
            />
          ),
          code: ({ inline, className, children, ...props }: {
            inline?: boolean
            className?: string
            children?: React.ReactNode
          }) =>
            inline ? (
              <code
                className="bg-muted rounded px-1 py-0.5 font-mono text-[0.9em]"
                {...props}
              >
                {children}
              </code>
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            ),
          a: (props) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer"
              className="underline"
            />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function ToolCallView({ part }: { part: Extract<Part, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false)
  const Icon =
    part.state === 'output-error'
      ? XCircle
      : part.state === 'output-available'
        ? Check
        : Terminal

  const tone =
    part.state === 'output-error'
      ? 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300'
      : part.state === 'output-available'
        ? 'border-emerald-500/30 bg-emerald-500/5'
        : 'border-amber-500/30 bg-amber-500/5'

  return (
    <div className={cn('rounded-md border text-xs min-w-0', tone)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <Icon className="size-3 shrink-0" />
        <span className="truncate font-mono">{part.toolName}</span>
        <span className="text-muted-foreground ml-auto truncate text-[10px]">
          {part.state === 'input-available' && 'running…'}
          {part.state === 'output-available' && 'ok'}
          {part.state === 'output-error' && (part.errorText ?? 'failed')}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t px-2.5 py-2 min-w-0">
          <div>
            <div className="text-muted-foreground mb-1 text-[10px] uppercase">
              Input
            </div>
            <pre className="bg-background/50 max-h-40 overflow-auto rounded p-2 font-mono text-[10px] leading-relaxed">
              <code>{stringifySafe(part.input)}</code>
            </pre>
          </div>
          {part.output !== undefined && (
            <div>
              <div className="text-muted-foreground mb-1 text-[10px] uppercase">
                Output
              </div>
              <pre className="bg-background/50 max-h-40 overflow-auto rounded p-2 font-mono text-[10px] leading-relaxed">
                <code>{stringifySafe(part.output)}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function stringifySafe(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

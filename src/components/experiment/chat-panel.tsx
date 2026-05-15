import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, ChevronDown, ChevronRight, Download, Send, Sparkles, Square, Terminal, XCircle } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import type { Part, UIMessage } from '#/lib/use-experiment-chat'
import { cn } from '#/lib/utils'
import type { ExperimentDraft } from '#/lib/types'

export function ChatPanel({
  messages,
  onSend,
  onStop,
  pending,
  exportFilename,
  exportContext,
  placeholder = 'Reply…',
}: {
  messages: UIMessage[]
  onSend: (content: string) => void
  onStop?: () => void
  pending?: boolean
  /** Suggested filename for the *Export chat* download (without extension). */
  exportFilename?: string
  /** Extra metadata + draft snapshot rendered at the top of the export. */
  exportContext?: {
    experimentId?: string
    title?: string | null
    repo?: string
    ref?: string
    draft?: ExperimentDraft
  }
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

  const exportChat = () => {
    if (typeof window === 'undefined') return
    const md = buildChatTranscript({ messages, context: exportContext })
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z')
    const name = `${exportFilename ?? 'chat'}-${stamp}.md`
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex items-center justify-end gap-2 border-b px-3 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={exportChat}
          disabled={messages.length === 0}
          title="Download the chat as a Markdown file"
        >
          <Download className="size-3.5" />
          Export
        </Button>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 min-w-0 w-full max-w-full flex-1 overflow-x-hidden overflow-y-auto"
      >
        <div className="w-full max-w-full min-w-0 space-y-4 px-4 py-3">
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
      </div>
      <div className="min-w-0 px-4 pt-3 pb-2">
        <div className="flex min-w-0 items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className="min-h-[60px] min-w-0 resize-none"
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
      <div className="flex w-full min-w-0 justify-end">
        <div className="bg-primary text-primary-foreground max-w-[85%] min-w-0 overflow-hidden rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {message.parts
            .map((p) => (p.kind === 'text' ? p.text : ''))
            .join('')}
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-2 overflow-hidden text-sm">
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
    <div className="prose prose-sm dark:prose-invert max-w-full min-w-0 overflow-hidden break-words leading-relaxed [overflow-wrap:anywhere] [&_*]:max-w-full [&_a]:break-all [&_li]:break-words [&_p]:break-words [&_table]:block [&_table]:overflow-x-auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Force code blocks to wrap inside the resizable panel.
          pre: (props) => (
            <pre
              {...props}
              className="bg-muted max-w-full overflow-x-auto rounded-md p-3 text-[12px] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
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
              <code
                className={cn(
                  className,
                  'whitespace-pre-wrap break-words [overflow-wrap:anywhere]',
                )}
                {...props}
              >
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
    <div className={cn('min-w-0 max-w-full overflow-hidden rounded-md border text-xs', tone)}>
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
        <div className="min-w-0 space-y-2 border-t px-2.5 py-2">
          <div>
            <div className="text-muted-foreground mb-1 text-[10px] uppercase">
              Input
            </div>
            <pre className="bg-background/50 max-h-40 max-w-full overflow-auto rounded p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              <code>{stringifySafe(part.input)}</code>
            </pre>
          </div>
          {part.output !== undefined && (
            <div>
              <div className="text-muted-foreground mb-1 text-[10px] uppercase">
                Output
              </div>
              <pre className="bg-background/50 max-h-40 max-w-full overflow-auto rounded p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
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

/** Build a self-contained Markdown transcript:
 *   1. A short explanation of what this file is.
 *   2. A summary table of the experiment design (goal, sub-goals, artifacts,
 *      metrics, harness summary, evaluators).
 *   3. The full chat history — text + tool calls.
 */
function buildChatTranscript({
  messages,
  context,
}: {
  messages: UIMessage[]
  context?: {
    experimentId?: string
    title?: string | null
    repo?: string
    ref?: string
    draft?: ExperimentDraft
  }
}): string {
  const lines: string[] = []
  const titleLine = context?.title?.trim() || 'Untitled experiment'

  lines.push(`# ${titleLine}`)
  lines.push('')
  lines.push(
    'This document is a transcript of an experiment created by the user in ' +
      '[Harness](https://github.com/trytilde/harness-shop). It captures the ' +
      'design the user agreed with the agent (goal, sub-goals, artifacts, ' +
      'metrics, harness summary, evaluators) followed by the full chat ' +
      'history that produced it.',
  )
  lines.push('')
  if (context?.experimentId) {
    lines.push(`- **Experiment id:** \`${context.experimentId}\``)
  }
  if (context?.repo) {
    lines.push(`- **Repository:** \`${context.repo}\``)
  }
  if (context?.ref) {
    lines.push(`- **Ref:** \`${context.ref}\``)
  }
  lines.push(`- **Exported:** ${new Date().toISOString()}`)
  lines.push('')

  if (context?.draft) {
    lines.push('## Experiment summary')
    lines.push('')
    lines.push('| Section | Content |')
    lines.push('|---|---|')
    lines.push(`| Goal | ${cell(context.draft.goal || '_(not set yet)_')} |`)
    lines.push(`| Sub-goals | ${cell(formatSubGoals(context.draft))} |`)
    lines.push(`| Output artifacts | ${cell(formatArtifacts(context.draft))} |`)
    lines.push(`| Metrics | ${cell(formatMetrics(context.draft))} |`)
    lines.push(`| Harness summary | ${cell(formatHarness(context.draft))} |`)
    lines.push(`| Evaluators | ${cell(formatEvaluators(context.draft))} |`)
    lines.push('')
  }

  lines.push('## Chat')
  lines.push('')
  for (const msg of messages) {
    lines.push(msg.role === 'user' ? `### You` : `### Agent`)
    lines.push('')
    for (const part of msg.parts) {
      if (part.kind === 'text') {
        if (part.text.trim().length > 0) {
          lines.push(part.text.trim())
          lines.push('')
        }
      } else {
        const stateNote =
          part.state === 'output-error'
            ? `failed${part.errorText ? `: ${part.errorText}` : ''}`
            : part.state === 'output-available'
              ? 'ok'
              : 'in progress'
        lines.push(`> 🔧 \`${part.toolName}\` — ${stateNote}`)
        if (part.input !== undefined) {
          lines.push('')
          lines.push('<details><summary>input</summary>')
          lines.push('')
          lines.push('```json')
          lines.push(stringifySafe(part.input))
          lines.push('```')
          lines.push('')
          lines.push('</details>')
        }
        if (part.output !== undefined) {
          lines.push('')
          lines.push('<details><summary>output</summary>')
          lines.push('')
          lines.push('```json')
          lines.push(stringifySafe(part.output))
          lines.push('```')
          lines.push('')
          lines.push('</details>')
        }
        lines.push('')
      }
    }
  }
  return lines.join('\n')
}

function cell(content: string): string {
  // Escape pipes (would split the cell) and replace newlines with <br/> so
  // multi-line content renders cleanly inside a table row.
  return content.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br/>')
}

function formatSubGoals(d: ExperimentDraft): string {
  if (!d.subGoals.length) return '_(none yet)_'
  return d.subGoals
    .map(
      (sg) =>
        `• **[${sg.kind}]** ${sg.title} — ${sg.description}` +
        (sg.artifactDeps.length
          ? ` _(deps: ${sg.artifactDeps
              .map((id) => d.artifacts.find((a) => a.id === id)?.name ?? id)
              .join(', ')})_`
          : ''),
    )
    .join('\n')
}

function formatArtifacts(d: ExperimentDraft): string {
  if (!d.artifacts.length) return '_(none yet)_'
  return d.artifacts
    .map(
      (a) =>
        `• **${a.name}**${a.path ? ` _(\`${a.path}\`)_` : ''} — ${a.description}`,
    )
    .join('\n')
}

function formatMetrics(d: ExperimentDraft): string {
  const metrics = d.metrics ?? []
  if (!metrics.length) return '_(none yet)_'
  return metrics
    .map(
      (m) =>
        `• **${m.name}**${m.unit ? ` _(${m.unit})_` : ''} — ${m.description}` +
        (m.target ? ` _(target: ${m.target})_` : ''),
    )
    .join('\n')
}

function formatHarness(d: ExperimentDraft): string {
  const desc = d.harness.description?.trim()
  if (!desc) return '_(harness not drafted yet)_'
  return desc
}

function formatEvaluators(d: ExperimentDraft): string {
  const withEval = d.subGoals.filter((sg) => sg.evaluator)
  if (!withEval.length) return '_(no evaluators yet)_'
  return withEval
    .map((sg) => {
      const preview = (sg.evaluator ?? '').trim().split(/\r?\n/).slice(0, 3).join(' ')
      return `• **[${sg.kind}]** ${sg.title} — ${preview.length > 200 ? preview.slice(0, 200) + '…' : preview}`
    })
    .join('\n')
}

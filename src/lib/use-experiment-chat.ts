import { useCallback, useEffect, useRef, useState } from 'react'

import { getChatHistoryFn } from '#/server/api/chat-history'

export type ToolPart = {
  kind: 'tool'
  toolCallId: string
  toolName: string
  state: 'input-available' | 'output-available' | 'output-error'
  input?: unknown
  output?: unknown
  errorText?: string
}

export type TextPart = { kind: 'text'; id: string; text: string }
export type Part = TextPart | ToolPart

export type UIMessage = {
  id: string
  role: 'user' | 'assistant'
  parts: Part[]
}

type WireEvent =
  | { type: 'start'; messageId: string }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | {
      type: 'tool-input-available'
      toolCallId: string
      toolName: string
      input: unknown
    }
  | {
      type: 'tool-output-available'
      toolCallId: string
      output: unknown
      isError?: boolean
    }
  | { type: 'error'; errorText: string }
  | { type: 'finish' }

/**
 * Chat hook backed by a resumable SSE stream:
 *   - POST /api/experiments/$id/chat starts a new turn (server runs the
 *     agent decoupled from the response so refresh doesn't kill it).
 *   - GET  /api/experiments/$id/chat attaches to an in-flight turn (replay
 *     buffered events + live tail).
 *   - POST /api/experiments/$id/chat/cancel aborts the agent.
 *
 * On mount we (a) fetch persisted history, then (b) try to attach to an
 * in-flight stream. Bootstrap only fires for genuinely new experiments.
 */
export function useExperimentChat(experimentId: string | null) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [toolCompletionTick, setToolCompletionTick] = useState(0)
  const sentBootstrapRef = useRef(false)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)

  /** Apply a single decoded event to local message state. */
  const applyEvent = useCallback((ev: WireEvent, ctx: { assistantId: string | null }) => {
    const ensureAssistant = () => {
      if (ctx.assistantId) return ctx.assistantId
      ctx.assistantId = `a_${Date.now()}`
      setMessages((m) => [
        ...m,
        { id: ctx.assistantId!, role: 'assistant', parts: [] },
      ])
      return ctx.assistantId
    }

    if (ev.type === 'start') {
      ctx.assistantId = ev.messageId
      setMessages((m) =>
        m.find((msg) => msg.id === ev.messageId)
          ? m
          : [...m, { id: ev.messageId, role: 'assistant', parts: [] }],
      )
    } else if (ev.type === 'text-start') {
      const id = ensureAssistant()
      setMessages((m) =>
        m.map((msg) =>
          msg.id === id &&
          !msg.parts.some((p) => p.kind === 'text' && p.id === ev.id)
            ? {
                ...msg,
                parts: [...msg.parts, { kind: 'text', id: ev.id, text: '' }],
              }
            : msg,
        ),
      )
    } else if (ev.type === 'text-delta') {
      const id = ensureAssistant()
      setMessages((m) =>
        m.map((msg) => {
          if (msg.id !== id) return msg
          let found = false
          const parts = msg.parts.map((p) => {
            if (p.kind === 'text' && p.id === ev.id) {
              found = true
              return { ...p, text: p.text + ev.delta }
            }
            return p
          })
          if (!found) parts.push({ kind: 'text', id: ev.id, text: ev.delta })
          return { ...msg, parts }
        }),
      )
    } else if (ev.type === 'tool-input-available') {
      const id = ensureAssistant()
      setMessages((m) =>
        m.map((msg) =>
          msg.id === id &&
          !msg.parts.some((p) => p.kind === 'tool' && p.toolCallId === ev.toolCallId)
            ? {
                ...msg,
                parts: [
                  ...msg.parts,
                  {
                    kind: 'tool',
                    toolCallId: ev.toolCallId,
                    toolName: ev.toolName,
                    state: 'input-available',
                    input: ev.input,
                  },
                ],
              }
            : msg,
        ),
      )
    } else if (ev.type === 'tool-output-available') {
      const id = ensureAssistant()
      setMessages((m) =>
        m.map((msg) => {
          if (msg.id !== id) return msg
          return {
            ...msg,
            parts: msg.parts.map((p) =>
              p.kind === 'tool' && p.toolCallId === ev.toolCallId
                ? {
                    ...p,
                    state: ev.isError ? 'output-error' : 'output-available',
                    output: ev.output,
                    errorText: ev.isError
                      ? ((ev.output as { error?: string })?.error ??
                        'tool failed')
                      : undefined,
                  }
                : p,
            ),
          }
        }),
      )
      setToolCompletionTick((n) => n + 1)
    } else if (ev.type === 'error') {
      setError(ev.errorText)
    }
  }, [])

  /** Read a Response body as SSE events, applying each to message state. */
  const consumeStream = useCallback(
    async (res: Response) => {
      if (!res.ok || !res.body) {
        throw new Error(`Chat stream failed (${res.status})`)
      }
      const reader = res.body.getReader()
      readerRef.current = reader
      const decoder = new TextDecoder()
      let buffer = ''
      const ctx = { assistantId: null as string | null }
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const blocks = buffer.split(/\n\n/)
          buffer = blocks.pop() ?? ''
          for (const block of blocks) {
            const line = block
              .split('\n')
              .find((l) => l.startsWith('data:'))
              ?.replace(/^data:\s?/, '')
            if (!line) continue
            try {
              applyEvent(JSON.parse(line) as WireEvent, ctx)
            } catch (e) {
              console.warn('chat parse error', e, line)
            }
          }
        }
      } finally {
        readerRef.current = null
      }
    },
    [applyEvent],
  )

  const sendMessage = useCallback(
    async (text: string) => {
      if (!experimentId) return
      setError(null)
      setPending(true)

      if (text.trim()) {
        const userMsg: UIMessage = {
          id: `u_${Date.now()}`,
          role: 'user',
          parts: [{ kind: 'text', id: 'u', text }],
        }
        setMessages((m) => [...m, userMsg])
      }

      try {
        const res = await fetch(`/api/experiments/${experimentId}/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: text }),
        })
        if (res.status === 409) {
          // A turn is already running — attach to it instead.
          await consumeStream(
            await fetch(`/api/experiments/${experimentId}/chat`, {
              method: 'GET',
            }),
          )
          return
        }
        await consumeStream(res)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setError((e as Error).message)
      } finally {
        setPending(false)
      }
    },
    [experimentId, consumeStream],
  )

  /** Cancel the in-flight turn (server-side). */
  const cancel = useCallback(async () => {
    if (!experimentId) return
    try {
      await fetch(`/api/experiments/${experimentId}/chat/cancel`, {
        method: 'POST',
      })
    } catch {
      /* ignore */
    }
    // Also detach our local reader so we stop adding events.
    try {
      await readerRef.current?.cancel()
    } catch {}
    readerRef.current = null
    setPending(false)
  }, [experimentId])

  // Load persisted history, then attempt to attach to any in-flight stream.
  useEffect(() => {
    if (!experimentId) return
    let cancelled = false
    sentBootstrapRef.current = false
    setHistoryLoaded(false)

    void (async () => {
      try {
        const rows = await getChatHistoryFn({ data: { experimentId } })
        if (cancelled) return
        if (rows.length > 0) {
          setMessages(
            rows.map((r) => ({
              id: r.id,
              role: r.role,
              parts: r.parts as UIMessage['parts'],
            })),
          )
          sentBootstrapRef.current = true
        } else {
          setMessages([])
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setHistoryLoaded(true)
      }

      // Try attaching to an in-flight stream (resume after refresh).
      try {
        const res = await fetch(`/api/experiments/${experimentId}/chat`, {
          method: 'GET',
        })
        if (cancelled) return
        if (res.ok && res.body) {
          setPending(true)
          // Don't await — let it stream in the background.
          void consumeStream(res)
            .catch((e) => setError((e as Error).message))
            .finally(() => {
              if (!cancelled) setPending(false)
            })
          // If we found an in-flight stream, suppress bootstrap.
          sentBootstrapRef.current = true
        }
      } catch {
        /* no in-flight stream */
      }
    })()

    return () => {
      cancelled = true
    }
  }, [experimentId, consumeStream])

  /** Start a new turn iff we have no history and no in-flight stream. */
  const bootstrap = useCallback(async () => {
    if (sentBootstrapRef.current || !experimentId || !historyLoaded) return
    sentBootstrapRef.current = true
    await sendMessage('')
  }, [experimentId, historyLoaded, sendMessage])

  return {
    messages,
    pending,
    error,
    historyLoaded,
    sendMessage,
    cancel,
    bootstrap,
    toolCompletionTick,
  }
}

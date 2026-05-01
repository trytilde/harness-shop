import { createFileRoute } from '@tanstack/react-router'

import { runAgentTurn } from '#/server/agent/codex-runner'
import type { StoredPart } from '#/server/api/chat-history'
import { persistChatMessage } from '#/server/chat/persist'
import {
  cancelStream,
  emit,
  finishStream,
  getStream,
  startStream,
  type ActiveStream,
  type WireEvent,
} from '#/server/chat/active-streams'

/** Roundtrip through JSON so any unknown-typed payload becomes JSON-safe. */
function jsonable(v: unknown): never {
  return JSON.parse(JSON.stringify(v ?? null)) as never
}

/**
 * SSE chat endpoint.
 *
 * - POST: starts a new turn for `experimentId`. Body `{ message: string }`.
 *   Rejects with 409 if a turn is already in flight for this experiment.
 * - GET:  attaches to the in-flight turn for `experimentId` (replays buffered
 *   events, then live-tails until the turn ends). 404 if no active turn.
 *
 * Closing the HTTP response (browser refresh, navigation, fetch abort) does
 * NOT abort the agent — it just drops a subscriber. The agent only stops on
 * an explicit POST to the cancel endpoint.
 */
export const Route = createFileRoute('/api/experiments/$experimentId/chat')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const body = (await request.json().catch(() => ({}))) as {
          message?: string
        }
        const message = (body.message ?? '').toString()

        const messageId = crypto.randomUUID()
        const stream = startStream(params.experimentId, messageId)
        if (!stream) {
          return new Response('A turn is already in progress.', {
            status: 409,
          })
        }

        emit(stream, { type: 'start', messageId })

        // Persist user turn (skipped for empty bootstrap calls).
        if (message.trim().length > 0) {
          await persistChatMessage({
            experimentId: params.experimentId,
            id: `u_${crypto.randomUUID()}`,
            role: 'user',
            parts: [{ kind: 'text', id: 'u', text: message }],
          }).catch(() => {})
        }

        // Run the agent in the background — decoupled from this HTTP response.
        // The response below is just the *first* subscriber; later GETs can
        // attach too, and the agent finishes regardless.
        void runTurnInBackground(stream, params.experimentId, message)

        return subscribeAsResponse(stream)
      },
      GET: async ({ params }) => {
        const stream = getStream(params.experimentId)
        if (!stream) {
          return new Response('no active stream', { status: 404 })
        }
        return subscribeAsResponse(stream)
      },
    },
  },
})

/** Build an SSE Response that replays existing events then tails live ones. */
function subscribeAsResponse(stream: ActiveStream): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      let closed = false
      const send = (ev: WireEvent) => {
        if (closed) return
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(ev)}\n\n`),
          )
        } catch {
          closed = true
        }
      }

      // 1. Replay everything so far.
      for (const ev of stream.events) send(ev)

      // 2. If already done, close.
      if (stream.done) {
        try {
          controller.close()
        } catch {}
        return
      }

      // 3. Otherwise subscribe for live tail.
      const onEvent = (ev: WireEvent) => {
        send(ev)
        if (ev.type === 'finish') {
          stream.subscribers.delete(onEvent)
          try {
            controller.close()
          } catch {}
          closed = true
        }
      }
      stream.subscribers.add(onEvent)
    },
    cancel() {
      // Subscriber went away — that's fine, the agent keeps going.
    },
  })

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}

async function runTurnInBackground(
  stream: ActiveStream,
  experimentId: string,
  userMessage: string,
) {
  // Track which agent_message item we're streaming text for.
  const lastText = new Map<string, string>()
  let activeTextId: string | null = null

  const partByItemId = new Map<string, StoredPart>()
  const ensureText = (id: string) => {
    if (activeTextId !== id) {
      if (activeTextId) emit(stream, { type: 'text-end', id: activeTextId })
      activeTextId = id
      emit(stream, { type: 'text-start', id })
    }
  }

  try {
    for await (const ev of runAgentTurn({
      experimentId,
      userMessage,
      signal: stream.abort.signal,
    })) {
      if (ev.type === 'item') {
        const it = ev.item
        if (it.type === 'agent_message') {
          ensureText(it.id)
          const prev = lastText.get(it.id) ?? ''
          const next = it.text ?? ''
          if (next.length > prev.length) {
            const delta = next.slice(prev.length)
            emit(stream, { type: 'text-delta', id: it.id, delta })
            lastText.set(it.id, next)
          } else if (next !== prev) {
            emit(stream, { type: 'text-delta', id: it.id, delta: next })
            lastText.set(it.id, next)
          }
          let part = partByItemId.get(it.id) as
            | (StoredPart & { kind: 'text' })
            | undefined
          if (!part) {
            part = { kind: 'text', id: it.id, text: next }
            partByItemId.set(it.id, part)
            stream.assistantParts.push(part)
          } else {
            part.text = next
          }
          if (ev.stage === 'completed') {
            emit(stream, { type: 'text-end', id: it.id })
            if (activeTextId === it.id) activeTextId = null
          }
        } else if (it.type === 'mcp_tool_call') {
          if (ev.stage === 'started') {
            emit(stream, {
              type: 'tool-input-available',
              toolCallId: it.id,
              toolName: `${it.server}.${it.tool}`,
              input: it.arguments,
            })
            const part = {
              kind: 'tool' as const,
              toolCallId: it.id,
              toolName: `${it.server}.${it.tool}`,
              state: 'input-available' as const,
              input: jsonable(it.arguments),
            } satisfies StoredPart
            partByItemId.set(it.id, part)
            stream.assistantParts.push(part)
          } else if (ev.stage === 'completed') {
            const isError = Boolean(it.error)
            const output = isError
              ? { error: it.error?.message ?? 'tool failed' }
              : (it.result?.structured_content ??
                it.result?.content ??
                null)
            emit(stream, {
              type: 'tool-output-available',
              toolCallId: it.id,
              output,
              isError,
            })
            const existing = partByItemId.get(it.id) as
              | (StoredPart & { kind: 'tool' })
              | undefined
            if (existing) {
              existing.state = isError
                ? 'output-error'
                : 'output-available'
              existing.output = jsonable(output)
              if (isError)
                existing.errorText = it.error?.message ?? 'tool failed'
            }
          }
        } else if (it.type === 'error') {
          emit(stream, { type: 'error', errorText: it.message })
        }
      } else if (ev.type === 'error') {
        emit(stream, { type: 'error', errorText: ev.message })
      } else if (ev.type === 'turn.completed') {
        if (activeTextId) {
          emit(stream, { type: 'text-end', id: activeTextId })
          activeTextId = null
        }
      }
    }
  } catch (e) {
    emit(stream, { type: 'error', errorText: (e as Error).message })
  } finally {
    if (stream.assistantParts.length > 0) {
      await persistChatMessage({
        experimentId,
        id: stream.messageId,
        role: 'assistant',
        parts: stream.assistantParts,
      }).catch(() => {})
    }
    finishStream(stream)
  }
}

// Keep the cancel helper next to the route so it's discoverable.
export { cancelStream }

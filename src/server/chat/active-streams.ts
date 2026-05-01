import type { StoredPart } from '#/server/api/chat-history'

/**
 * Wire-format event the SSE route emits and the client decodes. Same shape
 * as `WireEvent` in src/lib/use-experiment-chat.ts — duplicated here so the
 * server module doesn't import client-only code.
 */
export type WireEvent =
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

export type ActiveStream = {
  experimentId: string
  messageId: string
  startedAt: number
  /** All events since the turn started — replayed to late subscribers. */
  events: WireEvent[]
  /** Live subscribers (one per attached HTTP response). */
  subscribers: Set<(ev: WireEvent) => void>
  /** Set when the agent turn finishes; used to auto-evict. */
  done: boolean
  /** Used by the explicit cancel endpoint. */
  abort: AbortController
  /** Snapshot of the assistant's parts so far — written to DB on finish. */
  assistantParts: StoredPart[]
}

declare global {
  // eslint-disable-next-line no-var
  var __activeChatStreams: Map<string, ActiveStream> | undefined
}

const STREAM_TTL_AFTER_DONE_MS = 30 * 1000

function streams(): Map<string, ActiveStream> {
  if (!globalThis.__activeChatStreams)
    globalThis.__activeChatStreams = new Map()
  return globalThis.__activeChatStreams
}

export function getStream(experimentId: string): ActiveStream | undefined {
  return streams().get(experimentId)
}

export function startStream(
  experimentId: string,
  messageId: string,
): ActiveStream | null {
  pruneOld()
  const existing = streams().get(experimentId)
  if (existing) {
    // A finished stream may still be in the map for the 30 s reconnect
    // grace window — that should NOT block the user from starting a new
    // turn. Only an in-flight (not yet `done`) stream blocks.
    if (!existing.done) return null
    streams().delete(experimentId)
  }
  const stream: ActiveStream = {
    experimentId,
    messageId,
    startedAt: Date.now(),
    events: [],
    subscribers: new Set(),
    done: false,
    abort: new AbortController(),
    assistantParts: [],
  }
  streams().set(experimentId, stream)
  return stream
}

export function emit(stream: ActiveStream, ev: WireEvent) {
  stream.events.push(ev)
  for (const fn of stream.subscribers) {
    try {
      fn(ev)
    } catch {
      /* subscriber gone */
    }
  }
}

export function finishStream(stream: ActiveStream) {
  stream.done = true
  // Notify subscribers of finish (idempotent).
  for (const fn of stream.subscribers) {
    try {
      fn({ type: 'finish' })
    } catch {}
  }
  // Schedule eviction so a quick reconnect can still see the trailing state.
  setTimeout(() => {
    if (streams().get(stream.experimentId) === stream) {
      streams().delete(stream.experimentId)
    }
  }, STREAM_TTL_AFTER_DONE_MS)
}

export function cancelStream(experimentId: string): boolean {
  const s = streams().get(experimentId)
  if (!s) return false
  s.abort.abort()
  return true
}

function pruneOld() {
  const now = Date.now()
  const HALF_HOUR = 30 * 60 * 1000
  for (const [id, s] of streams()) {
    if (now - s.startedAt > HALF_HOUR) {
      try {
        s.abort.abort()
      } catch {}
      streams().delete(id)
    }
  }
}

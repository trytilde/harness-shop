import { useCallback, useEffect, useRef, useState } from 'react'

import {
  beginCodexOauthFn,
  beginGithubOauthFn,
  disconnectFn,
  getConnectionStatuses,
  getOauthFlowStatusFn,
  type ConnectionStatusDto,
  type ProviderId,
} from '#/server/api/connections'

export type ConnectionStatus = ConnectionStatusDto

export type ConnectionsState = {
  github: ConnectionStatus
  codex: ConnectionStatus
}

const EMPTY_STATE: ConnectionsState = {
  github: emptyStatus('github'),
  codex: emptyStatus('codex'),
}

function emptyStatus(id: ProviderId): ConnectionStatus {
  return {
    id,
    configured: id === 'codex',
    connected: false,
    callbackUrl: '',
    callbackPort: 0,
  }
}

let inflight: Promise<ConnectionsState> | null = null
const subscribers = new Set<(s: ConnectionsState) => void>()
let cache: ConnectionsState = EMPTY_STATE

async function fetchStatuses(): Promise<ConnectionsState> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const data = await getConnectionStatuses()
      cache = data
      subscribers.forEach((fn) => fn(data))
      return data
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export function useConnections() {
  const [state, setState] = useState<ConnectionsState>(cache)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    subscribers.add(setState)
    let cancelled = false
    fetchStatuses().then(() => {
      if (!cancelled) setLoading(false)
    })
    const onFocus = () => {
      void fetchStatuses()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      subscribers.delete(setState)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const refresh = useCallback(async () => {
    return fetchStatuses()
  }, [])

  const disconnect = useCallback(async (provider: ProviderId) => {
    await disconnectFn({ data: { provider } })
    await fetchStatuses()
  }, [])

  const allConnected = state.github.connected && state.codex.connected

  return { state, loading, allConnected, refresh, disconnect }
}

/**
 * Drives the popup-based OAuth flow: server gives us an authorize URL + state,
 * we open it in a new window, then poll the server until the listener
 * captures the callback.
 */
export function useOauthFlow(provider: ProviderId) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  const begin = useCallback(async () => {
    setError(null)
    setPending(true)
    try {
      const { authorizeUrl, state } =
        provider === 'github' ? await beginGithubOauthFn() : await beginCodexOauthFn()

      const popup = window.open(authorizeUrl, '_blank', 'noopener,noreferrer')
      if (!popup) {
        throw new Error('Popup blocked. Allow popups and try again.')
      }

      const result = await pollFlow(state, () => cancelRef.current !== null)
      if (!result.ok) throw new Error(result.message ?? 'Authorization failed')
      await fetchStatuses()
      return { ok: true as const }
    } catch (e) {
      const msg = (e as Error).message
      setError(msg)
      return { ok: false as const, message: msg }
    } finally {
      setPending(false)
    }
  }, [provider])

  const cancel = useCallback(() => {
    cancelRef.current = null
  }, [])

  return { begin, cancel, pending, error }
}

async function pollFlow(
  state: string,
  _isCancelled: () => boolean,
): Promise<{ ok: boolean; message?: string }> {
  const deadline = Date.now() + 5 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1200))
    try {
      const res = await getOauthFlowStatusFn({ data: { state } })
      if (res.status === 'done') {
        return { ok: res.ok, message: res.message }
      }
      if (res.status === 'unknown') {
        return { ok: true }
      }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }
  return { ok: false, message: 'Timed out waiting for authorization.' }
}

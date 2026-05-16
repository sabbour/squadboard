/**
 * consult-transport-fallback.test.ts — W28 J3
 *
 * Verifies the WS-first → SSE-fallback transport logic in useConsultStream:
 *   - Uses WS when wsClient.state === 'connected' on mount.
 *   - Falls back to SSE after 3 s if WS is not connected.
 *   - Falls back to SSE on mid-stream WS disconnect.
 *   - showRetryBar becomes true after two consecutive SSE errors.
 *
 * The WS client and EventSource are mocked; no real network is used.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ── Shared mock state (module-level, stable across tests) ─────────────────────

type StateListener = (s: string) => void

let _wsState = 'disconnected'
const _stateListeners = new Set<StateListener>()
const _handlers = new Map<string, Set<(p: unknown) => void>>()

function setWsState(state: string) {
  _wsState = state
  for (const l of _stateListeners) l(state)
}

const stableQc = { invalidateQueries: vi.fn() }

// ── Mocks declared before any imports ─────────────────────────────────────────

vi.mock('../../realtime/ws-client.ts', () => ({
  wsClient: {
    get state() { return _wsState },
    subscribeRoom: vi.fn(),
    unsubscribeRoom: vi.fn(),
    on: vi.fn((type: string, fn: (p: unknown) => void) => {
      if (!_handlers.has(type)) _handlers.set(type, new Set())
      _handlers.get(type)!.add(fn)
    }),
    off: vi.fn((type: string, fn: (p: unknown) => void) => {
      _handlers.get(type)?.delete(fn)
    }),
    onStateChange: vi.fn((listener: StateListener) => {
      _stateListeners.add(listener)
      listener(_wsState)
      return () => _stateListeners.delete(listener)
    }),
    send: vi.fn(),
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({ data: undefined, isLoading: false })),
  useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useQueryClient: vi.fn(() => stableQc),
}))

// ── Fake EventSource ──────────────────────────────────────────────────────────

interface FakeESInstance {
  url: string
  close: ReturnType<typeof vi.fn>
  simulateError: () => void
}

const _openEventSources: FakeESInstance[] = []

class FakeEventSource extends EventTarget {
  onerror: ((e: Event) => void) | null = null
  url: string
  readyState = 1

  constructor(url: string) {
    super()
    this.url = url
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    const instance: FakeESInstance = {
      url,
      close: vi.fn(() => { self.readyState = 2 }),
      simulateError: () => { self.onerror?.(new Event('error')) },
    }
    _openEventSources.push(instance)
    this.close = instance.close
  }

  close: ReturnType<typeof vi.fn> = vi.fn()
}

vi.stubGlobal('EventSource', FakeEventSource)

// ── Static import of the hook (resolved after mocks are set) ──────────────────

import { useConsultStream } from '../consult.ts'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useConsultStream transport fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _wsState = 'disconnected'
    _stateListeners.clear()
    _handlers.clear()
    _openEventSources.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts on WS transport when WS is connected', () => {
    _wsState = 'connected'
    const { result } = renderHook(() => useConsultStream('sess-ws'))
    expect(result.current.transport).toBe('ws')
    expect(_openEventSources).toHaveLength(0)
  })

  it('initial transport is ws even when WS is still connecting', () => {
    _wsState = 'connecting'
    const { result } = renderHook(() => useConsultStream('sess-init'))
    expect(result.current.transport).toBe('ws')
  })

  it('falls back to SSE after 3 s when WS is not connected', () => {
    _wsState = 'connecting'
    const { result } = renderHook(() => useConsultStream('sess-fallback'))
    expect(result.current.transport).toBe('ws')

    act(() => { vi.advanceTimersByTime(3_001) })

    expect(result.current.transport).toBe('sse')
    expect(_openEventSources.length).toBeGreaterThan(0)
    expect(_openEventSources[0].url).toContain('/api/consult/sess-fallback/stream')
  })

  it('does NOT fall back to SSE if WS connects within 3 s', () => {
    _wsState = 'connecting'
    const { result } = renderHook(() => useConsultStream('sess-quick'))

    act(() => {
      vi.advanceTimersByTime(1_000)
      setWsState('connected')
    })
    act(() => { vi.advanceTimersByTime(3_000) })

    expect(result.current.transport).toBe('ws')
    expect(_openEventSources).toHaveLength(0)
  })

  it('falls back to SSE on mid-stream WS disconnect', () => {
    _wsState = 'connected'
    const { result } = renderHook(() => useConsultStream('sess-mid'))
    expect(result.current.transport).toBe('ws')

    act(() => { setWsState('reconnecting') })

    expect(result.current.transport).toBe('sse')
    expect(_openEventSources.length).toBeGreaterThan(0)
  })

  it('sets showRetryBar after two SSE errors', () => {
    _wsState = 'disconnected'
    const { result } = renderHook(() => useConsultStream('sess-retry'))

    act(() => { vi.advanceTimersByTime(3_001) })
    expect(result.current.transport).toBe('sse')
    expect(result.current.showRetryBar).toBe(false)

    const es = _openEventSources[0]
    act(() => { es.simulateError() })
    expect(result.current.showRetryBar).toBe(false)

    act(() => { es.simulateError() })
    expect(result.current.showRetryBar).toBe(true)
  })
})

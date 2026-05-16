/**
 * useRunStream.test.ts — Wave 28 JIS-T7 regression
 *
 * Covers:
 *  - Initial HTTP fetch path
 *  - WS event append
 *  - WS reconnect → refetch with since_seq
 *  - steer() POST + error handling
 *  - Unsubscribe on unmount (no leak)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockApiFetch,
  mockConnect,
  mockDisconnect,
  mockOn,
  mockOff,
  mockOnStateChange,
  registeredHandlers,
  stateChangeListeners,
} = vi.hoisted(() => {
  const mockApiFetch = vi.fn()
  const mockConnect = vi.fn()
  const mockDisconnect = vi.fn()
  const registeredHandlers = new Map<string, Set<(p: unknown) => void>>()
  const stateChangeListeners = new Set<(state: string) => void>()

  const mockOn = vi.fn((type: string, fn: (p: unknown) => void) => {
    if (!registeredHandlers.has(type)) registeredHandlers.set(type, new Set())
    registeredHandlers.get(type)!.add(fn)
  })

  const mockOff = vi.fn((type: string, fn: (p: unknown) => void) => {
    registeredHandlers.get(type)?.delete(fn)
  })

  const mockOnStateChange = vi.fn((listener: (state: string) => void) => {
    stateChangeListeners.add(listener)
    listener('connected') // fire immediately
    return () => stateChangeListeners.delete(listener)
  })

  return {
    mockApiFetch,
    mockConnect,
    mockDisconnect,
    mockOn,
    mockOff,
    mockOnStateChange,
    registeredHandlers,
    stateChangeListeners,
  }
})

vi.mock('../../api/client.ts', () => ({ apiFetch: mockApiFetch }))
vi.mock('../../realtime/ws-client.ts', () => ({
  wsClient: {
    connect: mockConnect,
    disconnect: mockDisconnect,
    on: mockOn,
    off: mockOff,
    onStateChange: mockOnStateChange,
    state: 'connected',
  },
}))

import { useRunStream, ISSUE_RUN_EVENT_TYPES, type IssueRunEventRow } from '../useRunStream.ts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEventsResponse(events: IssueRunEventRow[] = [], nextSeq = 0) {
  return { events, total: events.length, nextSeq }
}

function emitWsEvent(type: string, payload: unknown) {
  const set = registeredHandlers.get(type)
  if (set) for (const fn of set) fn(payload)
}

function emitStateChange(state: string) {
  for (const fn of stateChangeListeners) fn(state)
}

const PROJECT_ID = 'proj-1'
const ISSUE_ID = 'issue-1'
const RUN_ID = 'run-abc'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useRunStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registeredHandlers.clear()
    stateChangeListeners.clear()
  })

  afterEach(() => {
    registeredHandlers.clear()
    stateChangeListeners.clear()
  })

  it('returns idle status when runId is null', () => {
    mockApiFetch.mockResolvedValue(makeEventsResponse())
    const { result } = renderHook(() => useRunStream(null, PROJECT_ID, ISSUE_ID))
    expect(result.current.status).toBe('idle')
    expect(result.current.events).toEqual([])
  })

  describe('initial fetch', () => {
    it('fetches events on mount and transitions to live', async () => {
      const event = {
        id: 'e1', runId: RUN_ID, seq: 0, eventType: 'issue.run.start',
        payload: { runId: RUN_ID, seq: 0, agentName: 'Fenster' },
        createdAt: new Date().toISOString(),
      }
      mockApiFetch.mockResolvedValueOnce(makeEventsResponse([event], 1))

      const { result } = renderHook(() => useRunStream(RUN_ID, PROJECT_ID, ISSUE_ID))
      expect(result.current.status).toBe('loading')

      await waitFor(() => expect(result.current.status).toBe('live'))
      expect(result.current.events).toHaveLength(1)
      expect(result.current.events[0].eventType).toBe('issue.run.start')
      expect(result.current.lastSeq).toBe(1)
    })

    it('transitions to finished if events contain issue.run.finish', async () => {
      const events = [
        { id: 'e1', runId: RUN_ID, seq: 0, eventType: 'issue.run.start', payload: { runId: RUN_ID, seq: 0 }, createdAt: new Date().toISOString() },
        { id: 'e2', runId: RUN_ID, seq: 1, eventType: 'issue.run.finish', payload: { runId: RUN_ID, seq: 1 }, createdAt: new Date().toISOString() },
      ]
      mockApiFetch.mockResolvedValueOnce(makeEventsResponse(events, 2))

      const { result } = renderHook(() => useRunStream(RUN_ID, PROJECT_ID, ISSUE_ID))
      await waitFor(() => expect(result.current.status).toBe('finished'))
    })

    it('sets error status on fetch failure', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useRunStream(RUN_ID, PROJECT_ID, ISSUE_ID))
      await waitFor(() => expect(result.current.status).toBe('error'))
      expect(result.current.error?.message).toBe('Network error')
    })
  })

  describe('WS event append', () => {
    it('appends WS events with matching runId', async () => {
      mockApiFetch.mockResolvedValueOnce(makeEventsResponse([], 0))

      const { result } = renderHook(() => useRunStream(RUN_ID, PROJECT_ID, ISSUE_ID))
      await waitFor(() => expect(result.current.status).toBe('live'))

      act(() => {
        emitWsEvent('issue.run.turn', { runId: RUN_ID, seq: 0, content: 'Hello' })
      })

      expect(result.current.events).toHaveLength(1)
      expect(result.current.events[0].eventType).toBe('issue.run.turn')
      expect(result.current.lastSeq).toBe(1)
    })

    it('ignores WS events for a different runId', async () => {
      mockApiFetch.mockResolvedValueOnce(makeEventsResponse([], 0))

      const { result } = renderHook(() => useRunStream(RUN_ID, PROJECT_ID, ISSUE_ID))
      await waitFor(() => expect(result.current.status).toBe('live'))

      act(() => {
        emitWsEvent('issue.run.turn', { runId: 'other-run', seq: 0, content: 'Hello' })
      })

      expect(result.current.events).toHaveLength(0)
    })

    it('transitions to finished on issue.run.finish WS event', async () => {
      mockApiFetch.mockResolvedValueOnce(makeEventsResponse([], 0))

      const { result } = renderHook(() => useRunStream(RUN_ID, PROJECT_ID, ISSUE_ID))
      await waitFor(() => expect(result.current.status).toBe('live'))

      act(() => {
        emitWsEvent('issue.run.finish', { runId: RUN_ID, seq: 5, durationMs: 3000 })
      })

      expect(result.current.status).toBe('finished')
    })

    it('deduplicates events with the same (eventType, seq)', async () => {
      mockApiFetch.mockResolvedValueOnce(makeEventsResponse([], 0))

      const { result } = renderHook(() => useRunStream(RUN_ID, PROJECT_ID, ISSUE_ID))
      await waitFor(() => expect(result.current.status).toBe('live'))

      act(() => {
        emitWsEvent('issue.run.turn', { runId: RUN_ID, seq: 0 })
        emitWsEvent('issue.run.turn', { runId: RUN_ID, seq: 0 }) // duplicate
      })

      expect(result.current.events).toHaveLength(1)
    })

    it('registers handlers for all 9 issue.run event types', async () => {
      mockApiFetch.mockResolvedValueOnce(makeEventsResponse([], 0))
      renderHook(() => useRunStream(RUN_ID, PROJECT_ID, ISSUE_ID))
      await waitFor(() => expect(mockOn).toHaveBeenCalled())

      for (const type of ISSUE_RUN_EVENT_TYPES) {
        expect(mockOn).toHaveBeenCalledWith(type, expect.any(Function))
      }
    })
  })

  describe('WS reconnect → refetch with since_seq', () => {
    it('refetches with since_seq on reconnect', async () => {
      const initialEvent = {
        id: 'e1', runId: RUN_ID, seq: 0, eventType: 'issue.run.start',
        payload: { runId: RUN_ID, seq: 0 }, createdAt: new Date().toISOString(),
      }
      mockApiFetch
        .mockResolvedValueOnce(makeEventsResponse([initialEvent], 1)) // initial fetch
        .mockResolvedValueOnce(makeEventsResponse([], 1))              // catch-up fetch

      // Don't fire 'connected' immediately — simulate reconnect
      mockOnStateChange.mockImplementationOnce((listener: (state: string) => void) => {
        stateChangeListeners.add(listener)
        return () => stateChangeListeners.delete(listener)
      })

      const { result } = renderHook(() => useRunStream(RUN_ID, PROJECT_ID, ISSUE_ID))
      await waitFor(() => expect(result.current.status).toBe('live'))

      // Simulate reconnect cycle
      act(() => emitStateChange('reconnecting'))
      expect(result.current.status).toBe('reconnecting')

      act(() => emitStateChange('connected'))

      await waitFor(() =>
        expect(mockApiFetch).toHaveBeenCalledWith(
          expect.stringContaining('since_seq=1'),
        ),
      )
    })
  })

  describe('steer()', () => {
    it('POSTs to the steer endpoint', async () => {
      mockApiFetch
        .mockResolvedValueOnce(makeEventsResponse([], 0))
        .mockResolvedValueOnce({ ok: true, eventSeq: 1 })

      const { result } = renderHook(() => useRunStream(RUN_ID, PROJECT_ID, ISSUE_ID))
      await waitFor(() => expect(result.current.status).toBe('live'))

      await act(async () => {
        await result.current.steer('Please focus on the auth module')
      })

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/api/projects/${PROJECT_ID}/issues/${ISSUE_ID}/runs/${RUN_ID}/steer`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ message: 'Please focus on the auth module' }),
        }),
      )
    })

    it('propagates steer errors to the caller', async () => {
      mockApiFetch
        .mockResolvedValueOnce(makeEventsResponse([], 0))
        .mockRejectedValueOnce(new Error('Run not active'))

      const { result } = renderHook(() => useRunStream(RUN_ID, PROJECT_ID, ISSUE_ID))
      await waitFor(() => expect(result.current.status).toBe('live'))

      await expect(result.current.steer('test')).rejects.toThrow('Run not active')
    })

    it('throws when runId is null', async () => {
      const { result } = renderHook(() => useRunStream(null, PROJECT_ID, ISSUE_ID))
      await expect(result.current.steer('test')).rejects.toThrow('No active run')
    })
  })

  describe('unsubscribe on unmount', () => {
    it('calls wsClient.off for all registered handlers on unmount', async () => {
      mockApiFetch.mockResolvedValueOnce(makeEventsResponse([], 0))

      const { unmount } = renderHook(() => useRunStream(RUN_ID, PROJECT_ID, ISSUE_ID))
      await waitFor(() => expect(mockOn).toHaveBeenCalled())

      unmount()

      for (const type of ISSUE_RUN_EVENT_TYPES) {
        expect(mockOff).toHaveBeenCalledWith(type, expect.any(Function))
      }
    })

    it('calls wsClient.disconnect on unmount', async () => {
      mockApiFetch.mockResolvedValueOnce(makeEventsResponse([], 0))

      const { unmount } = renderHook(() => useRunStream(RUN_ID, PROJECT_ID, ISSUE_ID))
      await waitFor(() => expect(mockConnect).toHaveBeenCalled())

      unmount()
      expect(mockDisconnect).toHaveBeenCalled()
    })

    it('does not update state after unmount (no leak)', async () => {
      const slowFetch = new Promise<ReturnType<typeof makeEventsResponse>>((resolve) =>
        setTimeout(() => resolve(makeEventsResponse([], 0)), 50),
      )
      mockApiFetch.mockReturnValueOnce(slowFetch)

      const { unmount } = renderHook(() => useRunStream(RUN_ID, PROJECT_ID, ISSUE_ID))
      unmount() // unmount before fetch resolves

      await slowFetch
      // No React state update after unmount — if this throws it was a real leak
    })
  })
})

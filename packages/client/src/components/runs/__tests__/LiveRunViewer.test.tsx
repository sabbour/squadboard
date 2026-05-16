/**
 * LiveRunViewer.test.tsx — Wave 28 JIS-T8 regression
 *
 * Covers:
 *  - Renders header + metrics + empty timeline + steer bar
 *  - Empty state, error state, finished state
 *  - Steer bar disabled when status !== 'live'
 *  - role="log" + aria-live="polite" on event stream
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockUseRunStream, mockSteer } = vi.hoisted(() => {
  const mockSteer = vi.fn().mockResolvedValue(undefined)
  const mockUseRunStream = vi.fn()
  return { mockUseRunStream, mockSteer }
})

vi.mock('../../../hooks/useRunStream.ts', () => ({
  useRunStream: mockUseRunStream,
  ISSUE_RUN_EVENT_TYPES: [
    'issue.run.start', 'issue.run.turn', 'issue.run.token',
    'issue.run.tool_call', 'issue.run.tool_result', 'issue.run.metric',
    'issue.run.finish', 'issue.run.error', 'issue.run.steered',
  ],
}))

import LiveRunViewer from '../LiveRunViewer.tsx'

// ─── jsdom shims ──────────────────────────────────────────────────────────────

beforeAll(() => {
  // jsdom doesn't implement ResizeObserver (used by Fluent2 MessageBar)
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // jsdom doesn't implement scrollIntoView
  Element.prototype.scrollIntoView = vi.fn()
})

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeStream(overrides: Partial<ReturnType<typeof mockUseRunStream>['return']> = {}) {
  return {
    events: [],
    status: 'live',
    lastSeq: 0,
    error: null,
    steer: mockSteer,
    ...overrides,
  }
}

function renderViewer(path = '/projects/proj-1/issues/issue-1/runs/run-abc/live') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/projects/:projectId/issues/:issueId/runs/:runId/live"
          element={<LiveRunViewer />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

const EVENTS = [
  {
    id: 'e1', runId: 'run-abc', seq: 0,
    eventType: 'issue.run.start',
    payload: { runId: 'run-abc', seq: 0, agentName: 'Fenster', model: 'gpt-4o' },
    createdAt: '2026-05-16T06:00:00.000Z',
  },
  {
    id: 'e2', runId: 'run-abc', seq: 1,
    eventType: 'issue.run.turn',
    payload: { runId: 'run-abc', seq: 1, role: 'assistant', content: 'Working...' },
    createdAt: '2026-05-16T06:00:01.000Z',
  },
]

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LiveRunViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseRunStream.mockReturnValue(makeStream())
  })

  describe('loading state', () => {
    it('shows a spinner while loading', () => {
      mockUseRunStream.mockReturnValue(makeStream({ status: 'loading' }))
      renderViewer()
      expect(screen.getByText('Loading run events...')).toBeInTheDocument()
    })
  })

  describe('header', () => {
    it('renders run ID truncated in header', () => {
      mockUseRunStream.mockReturnValue(makeStream({ events: EVENTS }))
      renderViewer()
      expect(screen.getByText(/run-abc/i)).toBeInTheDocument()
    })

    it('renders agent name and model from start event', () => {
      mockUseRunStream.mockReturnValue(makeStream({ events: EVENTS }))
      renderViewer()
      expect(screen.getByText('Fenster')).toBeInTheDocument()
      expect(screen.getByText('gpt-4o')).toBeInTheDocument()
    })

    it('renders status badge', () => {
      mockUseRunStream.mockReturnValue(makeStream({ status: 'live' }))
      renderViewer()
      expect(screen.getByText('Running')).toBeInTheDocument()
    })
  })

  describe('metrics row', () => {
    it('renders metric labels', () => {
      mockUseRunStream.mockReturnValue(makeStream())
      renderViewer()
      expect(screen.getByText('Input tokens')).toBeInTheDocument()
      expect(screen.getByText('Output tokens')).toBeInTheDocument()
      expect(screen.getByText('Cost')).toBeInTheDocument()
      expect(screen.getByText('Turns')).toBeInTheDocument()
    })

    it('shows zero values when no token events received', () => {
      mockUseRunStream.mockReturnValue(makeStream({ events: [] }))
      renderViewer()
      expect(screen.getByText('$0.0000')).toBeInTheDocument()
    })
  })

  describe('event stream', () => {
    it('renders role=log + aria-live=polite', () => {
      mockUseRunStream.mockReturnValue(makeStream({ events: EVENTS }))
      renderViewer()
      const log = screen.getByRole('log')
      expect(log).toBeInTheDocument()
      expect(log).toHaveAttribute('aria-live', 'polite')
    })

    it('renders event summaries in the stream', () => {
      mockUseRunStream.mockReturnValue(makeStream({ events: EVENTS }))
      renderViewer()
      expect(screen.getByText(/Run started — Fenster/)).toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('shows empty-state message when no events', () => {
      mockUseRunStream.mockReturnValue(makeStream({ events: [], status: 'live' }))
      renderViewer()
      expect(screen.getByText('No events yet')).toBeInTheDocument()
      expect(screen.getByText('The run has not emitted any events.')).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('shows error MessageBar when status is error', () => {
      mockUseRunStream.mockReturnValue(
        makeStream({ status: 'error', error: new Error('Connection refused') }),
      )
      renderViewer()
      expect(screen.getByText('Connection refused')).toBeInTheDocument()
    })

    it('shows finished badge when status is finished', () => {
      mockUseRunStream.mockReturnValue(makeStream({ status: 'finished' }))
      renderViewer()
      expect(screen.getByText('Finished')).toBeInTheDocument()
    })
  })

  describe('reconnecting state', () => {
    it('shows reconnecting MessageBar', () => {
      mockUseRunStream.mockReturnValue(makeStream({ status: 'reconnecting' }))
      renderViewer()
      expect(screen.getByText('Reconnecting to the event stream...')).toBeInTheDocument()
    })
  })

  describe('steer bar', () => {
    it('renders Input and Send button', () => {
      renderViewer()
      expect(screen.getByRole('textbox', { name: /steering message/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument()
    })

    it('Send button is disabled when status is not live', () => {
      mockUseRunStream.mockReturnValue(makeStream({ status: 'finished' }))
      renderViewer()
      expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
    })

    it('Input is disabled when status is not live', () => {
      mockUseRunStream.mockReturnValue(makeStream({ status: 'error' }))
      renderViewer()
      expect(screen.getByRole('textbox', { name: /steering message/i })).toBeDisabled()
    })

    it('calls steer() on form submit', async () => {
      const user = userEvent.setup()
      mockUseRunStream.mockReturnValue(makeStream({ status: 'live' }))
      renderViewer()

      const input = screen.getByRole('textbox', { name: /steering message/i })
      await user.type(input, 'Focus on auth')
      await user.click(screen.getByRole('button', { name: /send/i }))

      expect(mockSteer).toHaveBeenCalledWith('Focus on auth')
    })

    it('shows Sent at caption after successful steer', async () => {
      const user = userEvent.setup()
      mockUseRunStream.mockReturnValue(makeStream({ status: 'live' }))
      renderViewer()

      const input = screen.getByRole('textbox', { name: /steering message/i })
      await user.type(input, 'Go faster')
      await user.click(screen.getByRole('button', { name: /send/i }))

      expect(await screen.findByText(/Sent at/)).toBeInTheDocument()
    })

    it('shows error caption when steer fails', async () => {
      const user = userEvent.setup()
      mockSteer.mockRejectedValueOnce(new Error('Run is not active'))
      mockUseRunStream.mockReturnValue(makeStream({ status: 'live' }))
      renderViewer()

      const input = screen.getByRole('textbox', { name: /steering message/i })
      await user.type(input, 'Test')
      await user.click(screen.getByRole('button', { name: /send/i }))

      expect(await screen.findByText('Run is not active')).toBeInTheDocument()
    })
  })
})

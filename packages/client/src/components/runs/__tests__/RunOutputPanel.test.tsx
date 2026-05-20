import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import RunOutputPanel from '../RunOutputPanel'
import type { IssueRun } from '../../../api/runs'
import type { Agent } from '../../../api/agents'

const { mockUseRunStream, mockCancelMutate, mockWsSend, mockWsOn, mockWsOff } = vi.hoisted(() => ({
  mockUseRunStream: vi.fn(),
  mockCancelMutate: vi.fn(),
  mockWsSend: vi.fn(),
  mockWsOn: vi.fn(),
  mockWsOff: vi.fn(),
}))

vi.mock('../../../hooks/useRunStream.ts', () => ({
  useRunStream: mockUseRunStream,
}))

vi.mock('../../../api/runs.ts', () => ({
  useCancelRun: () => ({
    mutate: mockCancelMutate,
    isPending: false,
  }),
}))

vi.mock('../../../realtime/ws-client.ts', () => ({
  wsClient: {
    state: 'connected',
    send: mockWsSend,
    on: mockWsOn,
    off: mockWsOff,
  },
}))

vi.mock('../GitActions.tsx', () => ({
  default: () => <span>Git actions</span>,
}))

const agent: Agent = {
  id: 'agent-1',
  projectId: 'project-1',
  name: 'Kujan',
  role: 'Reviewer',
  status: 'active',
  charterPath: '.squad/agents/kujan.md',
  createdAt: '2026-05-20T14:00:00.000Z',
  updatedAt: '2026-05-20T14:00:00.000Z',
}

function makeRun(overrides: Partial<IssueRun> = {}): IssueRun {
  return {
    id: 'run-1',
    issueId: 'issue-1',
    agentId: 'agent-1',
    status: 'running',
    workspaceStrategy: 'scratch',
    workspacePath: '/tmp/squadboard-run-run-1',
    startedAt: '2026-05-20T14:00:00.000Z',
    costUsd: '0.0000',
    costTokens: 0,
    ...overrides,
  }
}

function makeStream(overrides: Record<string, unknown> = {}) {
  return {
    events: [],
    status: 'live',
    lastSeq: 0,
    error: null,
    steer: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  }
}

describe('RunOutputPanel live viewer', () => {
  beforeAll(() => {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseRunStream.mockReturnValue(makeStream())
  })

  it('surfaces live status, active step, timeline, and recovery markers', () => {
    mockUseRunStream.mockReturnValue(makeStream({
      events: [
        {
          id: 'evt-1',
          runId: 'run-1',
          seq: 0,
          eventType: 'issue.run.start',
          payload: { agentName: 'Kujan', taskTitle: 'Fix the viewer' },
          createdAt: '2026-05-20T14:00:00.000Z',
        },
        {
          id: 'evt-2',
          runId: 'run-1',
          seq: 1,
          eventType: 'issue.run.turn',
          payload: { role: 'assistant', content: 'Checking tests and updating layout' },
          createdAt: '2026-05-20T14:01:00.000Z',
        },
      ],
    }))

    render(
      <RunOutputPanel
        projectId="project-1"
        run={makeRun({
          output: '[auto-dispatched by pickup-ready sweep]\n[recovered: server restarted]\nContinuing implementation',
        })}
        agent={agent}
      />,
    )

    expect(screen.getByText('Active step')).toBeInTheDocument()
    expect(screen.getAllByText(/Checking tests and updating layout/).length).toBeGreaterThan(0)
    expect(screen.queryByText('/tmp/squadboard-run-run-1')).not.toBeInTheDocument()
    expect(screen.getAllByText('Running')).toHaveLength(1)
    expect(screen.getByText('Streamed event/log timeline')).toBeInTheDocument()
    expect(screen.getByText('Auto-started by scheduler')).toBeInTheDocument()
    expect(screen.getByText(/Recovered after restart/)).toBeInTheDocument()
    expect(screen.queryByText(/pickup-ready sweep/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /steer running agent/i })).toBeInTheDocument()

    const log = screen.getByRole('log', { name: /run log timeline/i })
    expect(log).toHaveAttribute('aria-live', 'polite')
  })

  it('renders a clear failed state with the error in the timeline', () => {
    render(
      <RunOutputPanel
        projectId="project-1"
        run={makeRun({
          status: 'failed',
          completedAt: '2026-05-20T14:05:00.000Z',
          output: 'Started work',
          errorMessage: 'Agent process exited with code 1',
        })}
        agent={agent}
      />,
    )

    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.getAllByText('Agent process exited with code 1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0)
    expect(screen.getByRole('log', { name: /run log timeline/i })).toHaveAttribute('aria-live', 'off')
  })

  it('handles completed runs with captured output', () => {
    render(
      <RunOutputPanel
        projectId="project-1"
        run={makeRun({
          status: 'completed',
          completedAt: '2026-05-20T14:03:00.000Z',
          output: 'Created the deliverable\nAll checks passed',
        })}
        agent={agent}
      />,
    )

    expect(screen.getByText('Run completed')).toBeInTheDocument()
    expect(screen.getByText('Created the deliverable')).toBeInTheDocument()
    expect(screen.getByText('All checks passed')).toBeInTheDocument()
  })

  it('handles an empty pending run without logs or events', () => {
    render(
      <RunOutputPanel
        projectId="project-1"
        run={makeRun({
          status: 'pending',
          startedAt: undefined,
          workspacePath: undefined,
          output: undefined,
        })}
        agent={agent}
      />,
    )

    expect(screen.getByText(/Waiting for the agent to start/)).toBeInTheDocument()
    expect(screen.getByText('Queued for execution')).toBeInTheDocument()
    expect(screen.getByText('Waiting for first event…')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /steer running agent/i })).not.toBeInTheDocument()
  })
})

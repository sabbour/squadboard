import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import CeremonyRuns from '../CeremonyRuns'
import type { CeremonyRunsResponse } from '../../api/ceremonies'

const navigateMock = vi.hoisted(() => vi.fn())
const apiMock = vi.hoisted(() => ({
  runsQuery: {
    data: undefined as CeremonyRunsResponse | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}))

vi.mock('react-router', () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
  useNavigate: () => navigateMock,
  useParams: () => ({ id: 'project-123', ceremonyId: 'ceremony-123' }),
  useSearchParams: () => [new URLSearchParams()],
}))

vi.mock('../../api/projects.ts', () => ({
  useProject: () => ({ data: { id: 'project-123', name: 'Test Project' } }),
}))

vi.mock('../../api/ceremonies.ts', () => ({
  useCeremonyRuns: () => apiMock.runsQuery,
}))

function renderCeremonyRuns() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <CeremonyRuns />
    </FluentProvider>,
  )
}

function makeRunsResponse(overrides: Partial<CeremonyRunsResponse> = {}): CeremonyRunsResponse {
  return {
    ceremony: {
      id: 'ceremony-123',
      projectId: 'project-123',
      name: 'Daily Close-Out',
      slug: 'daily-close-out',
      triggerKind: 'manual',
      kind: 'ceremony',
    },
    versions: [{ id: 'version-1', version: 1, createdAt: '2026-05-20T10:00:00.000Z' }],
    runs: [{
      id: 'workflow-run-123',
      issueId: 'issue-123',
      issueTitle: 'Prepare close-out',
      issueStatus: 'ready',
      workflowVersionId: 'version-1',
      workflowVersionNumber: 1,
      status: 'running',
      currentStepIndex: 0,
      triggerSource: { kind: 'manual' },
      premiumRequests: '0',
      createdAt: '2026-05-20T11:00:00.000Z',
      updatedAt: '2026-05-20T11:01:00.000Z',
      steps: [{
        id: 'step-1',
        workflowRunId: 'workflow-run-123',
        issueRunId: 'issue-run-123',
        stepIndex: 0,
        stepType: 'agent_run',
        status: 'running',
        output: 'step output',
        reviewDecision: null,
        reviewComment: null,
        sessionId: 'session-1',
        startedAt: '2026-05-20T11:00:10.000Z',
        createdAt: '2026-05-20T11:00:00.000Z',
        updatedAt: '2026-05-20T11:01:00.000Z',
        issueRunStatus: 'running',
        issueRunOutput: 'agent output',
        issueRunError: null,
        agentId: 'agent-1',
        agentName: 'Scribe',
        events: [{
          id: 1,
          runId: 'issue-run-123',
          seq: 0,
          eventType: 'issue.run.tool_call',
          payload: { toolName: 'gh' },
          createdAt: '2026-05-20T11:00:20.000Z',
        }],
      }],
    }],
    ...overrides,
  }
}

describe('CeremonyRuns page', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    apiMock.runsQuery.data = makeRunsResponse()
    apiMock.runsQuery.isLoading = false
    apiMock.runsQuery.isError = false
    apiMock.runsQuery.refetch.mockReset()
  })

  it('renders ceremony execution runs and step event logs', () => {
    renderCeremonyRuns()

    expect(screen.getByText('Daily Close-Out runs')).toBeInTheDocument()
    expect(screen.getByText('Prepare close-out')).toBeInTheDocument()
    expect(screen.getByText('Step 1: agent_run')).toBeInTheDocument()
    expect(screen.getByText('Scribe')).toBeInTheDocument()
    expect(screen.getByText('agent output')).toBeInTheDocument()
    expect(screen.getByText('Tool call - gh')).toBeInTheDocument()
  })

  it('opens the live issue-run log from a ceremony step', async () => {
    const user = userEvent.setup()
    renderCeremonyRuns()

    await user.click(screen.getByRole('button', { name: /open live log/i }))

    expect(navigateMock).toHaveBeenCalledWith('/projects/project-123/issues/issue-123/runs/issue-run-123/live')
  })

  it('renders an intentional empty state before a ceremony has run', () => {
    apiMock.runsQuery.data = makeRunsResponse({ runs: [] })

    renderCeremonyRuns()

    const heading = screen.getByRole('heading', { level: 2, name: 'No runs yet' })
    const body = screen.getByText(/Open the ceremony and choose Run now/i)

    expect(heading).toBeInTheDocument()
    expect(heading).not.toHaveTextContent(/Open the ceremony/i)
    expect(body.tagName).toBe('P')
    expect(body).toHaveTextContent(/linked agent event logs will appear here/i)
    expect(screen.getByRole('button', { name: /open ceremony to run/i })).toBeInTheDocument()
  })

  it('opens the ceremony editor from the empty state call to action', async () => {
    const user = userEvent.setup()
    apiMock.runsQuery.data = makeRunsResponse({ runs: [] })

    renderCeremonyRuns()

    await user.click(screen.getByRole('button', { name: /open ceremony to run/i }))

    expect(navigateMock).toHaveBeenCalledWith('/projects/project-123/ceremonies/ceremony-123')
  })
})

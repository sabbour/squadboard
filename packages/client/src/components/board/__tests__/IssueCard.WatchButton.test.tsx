/**
 * IssueCard.WatchButton.test.tsx — W28 JIS-T9 regression
 *
 * Covers:
 *  - Watch button only visible when run.status === 'running'
 *  - Watch button not shown for pending/completed/no-run states
 *  - Clicking Watch navigates to /projects/:pid/issues/:iid/runs/:rid/live
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ── Mock react-router ─────────────────────────────────────────────────────────

const mockNavigate = vi.fn()

vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
  useFetcher: () => ({ data: undefined, state: 'idle' }),
}))

// ── Mock @hello-pangea/dnd ────────────────────────────────────────────────────

vi.mock('@hello-pangea/dnd', () => ({
  Draggable: ({ children }: { children: (p: unknown, s: unknown) => React.ReactNode }) =>
    children({ innerRef: () => {}, draggableProps: {}, dragHandleProps: {} }, { isDragging: false }),
}))

// ── Mock API hooks ─────────────────────────────────────────────────────────────

const mockUseIssueRuns = vi.fn()
const mockUseActiveAgents = vi.fn()
const mockUseAssignIssue = vi.fn()

vi.mock('../../../api/runs', () => ({
  useIssueRuns: (...args: unknown[]) => mockUseIssueRuns(...args),
}))

vi.mock('../../../api/agents', () => ({
  useActiveAgents: (...args: unknown[]) => mockUseActiveAgents(...args),
}))

vi.mock('../../../api/issues', () => ({
  useAssignIssue: (...args: unknown[]) => mockUseAssignIssue(...args),
}))

vi.mock('../../runs/RunButton', () => ({
  default: () => <button data-testid="task-run-button">▶ Run</button>,
}))

vi.mock('../../runs/RunStatusBadge', () => ({
  default: () => <span data-testid="run-status-badge" />,
}))

vi.mock('../../runs/CostDisplay', () => ({
  default: () => <span data-testid="cost-display" />,
}))

vi.mock('../../LabelBadge', () => ({
  default: () => null,
}))

vi.mock('../../Avatar', () => ({
  default: () => <span />,
}))

vi.mock('../RoutingBadge', () => ({
  RoutingBadge: () => null,
}))

vi.mock('../WorkflowBadge', () => ({
  WorkflowBadge: () => null,
}))

vi.mock('../../routing/RoutingTierBadge', () => ({
  RoutingTierBadge: () => null,
}))

import IssueCard from '../IssueCard.tsx'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_ISSUE = {
  id: 'issue-1',
  title: 'Fix the thing',
  status: 'in_progress',
  labels: [],
  commentCount: 0,
  github: null,
  deliverableType: null,
  deliverableStatus: null,
  deliverableLink: null,
  assignee: null,
  routingRuleSummary: null,
  attachedWorkflowName: null,
}

const BASE_RUN = {
  id: 'run-42',
  issueId: 'issue-1',
  agentId: 'agent-1',
  workspaceStrategy: 'scratch' as const,
}

function renderCard(runs: unknown[]) {
  mockUseIssueRuns.mockReturnValue({ data: runs })
  mockUseActiveAgents.mockReturnValue({ data: [] })
  mockUseAssignIssue.mockReturnValue({ mutate: vi.fn() })

  return render(
    <IssueCard
      issue={BASE_ISSUE as never}
      index={0}
      projectId="proj-1"
      isSelected={false}
      onSelect={vi.fn()}
      onOpen={vi.fn()}
    />,
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('IssueCard — Watch button (JIS-T9)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not show Watch button when there is no active run', () => {
    renderCard([])
    expect(screen.queryByTestId('watch-run-button')).not.toBeInTheDocument()
  })

  it('does not show Watch button when run is pending', () => {
    renderCard([{ ...BASE_RUN, status: 'pending' }])
    expect(screen.queryByTestId('watch-run-button')).not.toBeInTheDocument()
  })

  it('does not show Watch button when run is completed', () => {
    renderCard([{ ...BASE_RUN, status: 'completed' }])
    expect(screen.queryByTestId('watch-run-button')).not.toBeInTheDocument()
  })

  it('shows Watch button when run.status === "running"', () => {
    renderCard([{ ...BASE_RUN, status: 'running' }])
    expect(screen.getByTestId('watch-run-button')).toBeInTheDocument()
    expect(screen.getByLabelText('Watch live run')).toBeInTheDocument()
  })

  it('clicking Watch navigates to the live run route', async () => {
    const user = userEvent.setup()
    renderCard([{ ...BASE_RUN, status: 'running' }])

    const btn = screen.getByTestId('watch-run-button')
    await user.click(btn)

    expect(mockNavigate).toHaveBeenCalledOnce()
    expect(mockNavigate).toHaveBeenCalledWith(
      '/projects/proj-1/issues/issue-1/runs/run-42/live',
    )
  })

  it('Watch button is not shown once run transitions to completed', () => {
    const { rerender } = renderCard([{ ...BASE_RUN, status: 'running' }])
    expect(screen.getByTestId('watch-run-button')).toBeInTheDocument()

    mockUseIssueRuns.mockReturnValue({ data: [{ ...BASE_RUN, status: 'completed' }] })
    rerender(
      <IssueCard
        issue={BASE_ISSUE as never}
        index={0}
        projectId="proj-1"
        isSelected={false}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('watch-run-button')).not.toBeInTheDocument()
  })
})

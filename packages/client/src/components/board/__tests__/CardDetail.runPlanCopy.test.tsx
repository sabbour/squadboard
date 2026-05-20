import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import CardDetail from '../CardDetail.tsx'
import type { Issue } from '../../../api/issues.ts'

const apiMocks = vi.hoisted(() => ({
  assignMutate: vi.fn(),
  updateDeliverableMutateAsync: vi.fn(),
  startWorkflowMutateAsync: vi.fn(),
}))

vi.mock('../../../api/issues.ts', () => ({
  useAssignIssue: () => ({ mutate: apiMocks.assignMutate, isPending: false }),
  useUpdateDeliverable: () => ({ mutateAsync: apiMocks.updateDeliverableMutateAsync }),
}))

vi.mock('../../../api/labels.ts', () => ({
  useLabels: () => ({ data: [] }),
}))

vi.mock('../../../api/runs.ts', () => ({
  useIssueRuns: () => ({ data: [] }),
}))

vi.mock('../../../api/agents.ts', () => ({
  useAgents: () => ({ data: [] }),
}))

vi.mock('../../../api/workflows.ts', () => ({
  useWorkflowRun: () => ({ data: null }),
  useStartWorkflow: () => ({ mutateAsync: apiMocks.startWorkflowMutateAsync, isPending: false }),
}))

vi.mock('../../../api/reviews.ts', () => ({
  useWorkflowRunReviews: () => ({ data: [] }),
}))

vi.mock('../../../api/deliverables.ts', () => ({
  useDeliverables: () => ({ data: [] }),
}))

vi.mock('../../../api/issue-attachments.ts', () => ({
  useIssueAttachments: () => ({ data: [] }),
}))

vi.mock('../CommentList.tsx', () => ({
  default: () => <div data-testid="comment-list" />,
}))

vi.mock('../AddComment.tsx', () => ({
  default: () => <div data-testid="add-comment" />,
}))

vi.mock('../../runs/RunOutputPanel.tsx', () => ({
  default: () => <div data-testid="run-output-panel" />,
}))

vi.mock('../../runs/RunHistory.tsx', () => ({
  default: () => <div data-testid="run-history" />,
}))

vi.mock('../../workflows/AttachWorkflowModal.tsx', () => ({
  AttachWorkflowModal: () => <div data-testid="attach-workflow-modal" />,
}))

vi.mock('../../reviews/ReviewPanel.tsx', () => ({
  ReviewPanel: () => <div data-testid="review-panel" />,
}))

vi.mock('../../deliverables/DeliverableList.tsx', () => ({
  default: () => <div data-testid="deliverable-list" />,
}))

vi.mock('../../flow/IssueFlowDag.tsx', () => ({
  default: () => <div data-testid="issue-flow-dag" />,
}))

vi.mock('../../issues/IssueBodyMarkdown.tsx', () => ({
  default: ({ value }: { value: string }) => <div>{value}</div>,
}))

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    title: 'Clarify run-plan chooser',
    body: '',
    column: 'ready',
    labels: [],
    assignee: null,
    commentCount: 0,
    createdAt: '2026-05-20T14:00:00.000Z',
    updatedAt: '2026-05-20T14:00:00.000Z',
    github: null,
    deliverableType: 'none',
    deliverableStatus: 'not-started',
    deliverableLink: null,
    ...overrides,
  }
}

function renderCardDetail(card: Issue) {
  return render(
    <CardDetail
      projectId="project-1"
      issue={card}
      onClose={vi.fn()}
    />,
  )
}

describe('CardDetail run-plan copy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('makes the implicit Work Pickup default safe to leave alone', () => {
    renderCardDetail(issue())

    expect(screen.getByText('Default plan: Work Pickup')).toBeInTheDocument()
    expect(screen.getByText(/Leave it alone unless this card needs a custom run plan/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Override default' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose plan' })).not.toBeInTheDocument()
  })

  it('labels an attached plan as an override of Work Pickup', () => {
    renderCardDetail(issue({
      attachedWorkflowId: 'workflow-1',
      attachedWorkflowName: 'Customer escalation plan',
    }))

    expect(screen.getByText('Customer escalation plan')).toBeInTheDocument()
    expect(screen.getByText('Overrides the default Work Pickup plan for this card.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change override' })).toBeInTheDocument()
  })
})

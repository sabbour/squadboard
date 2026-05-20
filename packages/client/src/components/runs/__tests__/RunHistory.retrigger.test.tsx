import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RunHistory from '../RunHistory'

const runsMock = vi.hoisted(() => ({
  issueRuns: [] as Array<{
    id: string
    issueId: string
    agentId: string
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    workspaceStrategy: 'scratch'
  }>,
  retrigger: {
    mutate: vi.fn(),
    isPending: false,
  },
}))

vi.mock('../../../api/runs.ts', () => ({
  useIssueRuns: () => ({ data: runsMock.issueRuns, isLoading: false }),
  useRetriggerRun: () => runsMock.retrigger,
}))

vi.mock('../../../api/agents.ts', () => ({
  useAgents: () => ({
    data: [{ id: 'agent-1', name: 'Kujan', role: 'Engineer' }],
  }),
}))

vi.mock('../RunStatusBadge.tsx', () => ({
  default: ({ status }: { status: string }) => <span>{status}</span>,
}))

vi.mock('../RunOutputPanel.tsx', () => ({
  default: () => <div>run output</div>,
}))

vi.mock('../CostDisplay.tsx', () => ({
  default: () => <span>$0.00</span>,
}))

vi.mock('../../Avatar.tsx', () => ({
  default: () => <span>K</span>,
}))

describe('RunHistory retrigger', () => {
  beforeEach(() => {
    runsMock.issueRuns = [{
      id: 'run-1',
      issueId: 'issue-1',
      agentId: 'agent-1',
      status: 'failed',
      workspaceStrategy: 'scratch',
    }]
    runsMock.retrigger.mutate.mockReset()
    runsMock.retrigger.isPending = false
  })

  it('shows a retrigger action for failed runs', () => {
    render(<RunHistory projectId="project-1" issueId="issue-1" />)

    expect(screen.getByRole('button', { name: /retrigger run run-1/i })).toBeInTheDocument()
  })

  it('starts a new run from the failed run when retrigger is clicked', async () => {
    const user = userEvent.setup()
    runsMock.retrigger.mutate.mockImplementation((_input: unknown, options?: { onSuccess?: (run: unknown) => void }) => {
      options?.onSuccess?.({
        id: 'run-2',
        issueId: 'issue-1',
        agentId: 'agent-1',
        status: 'pending',
        workspaceStrategy: 'scratch',
      })
    })

    render(<RunHistory projectId="project-1" issueId="issue-1" />)

    await user.click(screen.getByRole('button', { name: /retrigger run run-1/i }))

    expect(runsMock.retrigger.mutate).toHaveBeenCalledWith(
      { runId: 'run-1', issueId: 'issue-1' },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    )
  })

  it('disables retrigger while another run is active', () => {
    runsMock.issueRuns = [
      ...runsMock.issueRuns,
      {
        id: 'run-active',
        issueId: 'issue-1',
        agentId: 'agent-1',
        status: 'running',
        workspaceStrategy: 'scratch',
      },
    ]

    render(<RunHistory projectId="project-1" issueId="issue-1" />)

    expect(screen.getByRole('button', { name: /retrigger run run-1/i })).toBeDisabled()
  })
})

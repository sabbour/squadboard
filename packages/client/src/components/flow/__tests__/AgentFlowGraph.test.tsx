import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import AgentFlowGraph from '../AgentFlowGraph'
import type { FlowGraph } from '../../../api/flow'

const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>()
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

const graph: FlowGraph = {
  agents: [{
    agentId: 'agent-1',
    name: 'Ralph',
    role: 'Coordinator',
    instances: [{
      instanceId: 'run-1',
      instanceKind: 'issue_run',
      status: 'active',
      currentIssue: { issueId: 'issue-1', title: 'Fix launch blocker' },
      startedAt: '2026-05-20T04:00:00Z',
    }],
  }],
  edges: [],
}

describe('AgentFlowGraph navigation', () => {
  beforeEach(() => {
    navigateMock.mockReset()
  })

  it('opens the live run for issue-run instances', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AgentFlowGraph graph={graph} projectId="project-1" />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: /Ralph.*active/i }))

    expect(navigateMock).toHaveBeenCalledWith('/projects/project-1/issues/issue-1/runs/run-1/live')
  })
})

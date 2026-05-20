import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { MemoryRouter } from 'react-router'
import ProjectFlow from '../ProjectFlow'
import type { ProjectFlow as ProjectFlowData } from '../../api/flow'

const navigateMock = vi.hoisted(() => vi.fn())

const apiMock = vi.hoisted(() => ({
  flow: {
    columns: [],
    activeRunsCount: 0,
    pendingReviewsCount: 0,
  } as ProjectFlowData,
}))

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>()
  return {
    ...actual,
    useParams: () => ({ id: 'project-1' }),
    useNavigate: () => navigateMock,
  }
})

vi.mock('../../api/projects.ts', () => ({
  useProject: () => ({ data: { id: 'project-1', name: 'Launch Project' } }),
}))

vi.mock('../../api/flow.ts', () => ({
  useProjectFlow: () => ({ data: apiMock.flow, isLoading: false, error: null }),
  useAgentFlow: () => ({ data: { agents: [], edges: [] }, isLoading: false, error: null }),
}))

function renderProjectFlow() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <ProjectFlow />
      </MemoryRouter>
    </FluentProvider>,
  )
}

describe('ProjectFlow issue cards', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    apiMock.flow = {
      columns: [{
        slug: 'doing',
        name: 'Doing',
        color: '#58a6ff',
        issues: [{
          id: 'issue-1',
          title: 'Fix launch blocker',
          status: 'in_progress',
          activeRunSummary: {
            runId: 'run-1',
            kind: 'agent_run',
            status: 'running',
            agentName: 'Ralph',
            startedAt: '2026-05-20T04:00:00Z',
          },
          lastDeliverable: null,
        }],
      }],
      activeRunsCount: 1,
      pendingReviewsCount: 0,
    }
  })

  it('opens the live run when an issue card has an active run', async () => {
    const user = userEvent.setup()
    renderProjectFlow()

    await user.click(screen.getByRole('tab', { name: 'Issues' }))
    await user.click(screen.getByRole('button', { name: /Fix launch blocker/i }))

    expect(navigateMock).toHaveBeenCalledWith('/projects/project-1/issues/issue-1/runs/run-1/live')
  })
})

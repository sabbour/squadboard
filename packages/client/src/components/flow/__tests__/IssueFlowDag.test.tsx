import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import IssueFlowDag from '../IssueFlowDag'
import type { IssueFlow } from '../../../api/flow'
import type { IssueRun } from '../../../api/runs'
import type { IssueRunEventRow } from '../../../hooks/useRunStream'

const apiFetchMock = vi.hoisted(() => vi.fn())

vi.mock('../../../api/client.ts', () => ({
  apiFetch: apiFetchMock,
}))

vi.mock('../../../realtime/ws-client.ts', () => ({
  wsClient: {
    on: vi.fn(),
    off: vi.fn(),
  },
}))

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, edges, nodeTypes, children }: any) => (
    <div data-testid="react-flow">
      <div data-testid="nodes">
        {nodes.map((node: any) => {
          const NodeComponent = nodeTypes[node.type]
          return (
            <div key={node.id} data-testid="flow-node">
              <NodeComponent data={node.data} />
            </div>
          )
        })}
      </div>
      <div data-testid="edges">
        {edges.map((edge: any) => (
          <div key={edge.id}>{edge.source} → {edge.target}</div>
        ))}
      </div>
      {children}
    </div>
  ),
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => <div data-testid="flow-controls" />,
  Handle: () => null,
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Panel: ({ children }: any) => <div data-testid="flow-panel">{children}</div>,
  Position: { Top: 'top', Bottom: 'bottom' },
}))

const failedFlow: IssueFlow = {
  issue: {
    id: 'issue-1',
    title: 'Fix Work Pickup failure',
    columnSlug: 'in_progress',
    status: 'in_progress',
  },
  workflowVersion: null,
  stepRuns: [{
    id: 'run-1',
    stepIndex: 0,
    kind: 'agent_run',
    label: 'Agent run',
    status: 'failed',
    startedAt: '2026-05-20T05:00:00Z',
    completedAt: '2026-05-20T05:05:00Z',
    agentName: 'Keyser',
    agentRole: 'Engineer',
    parentStepRunId: null,
    childIds: [],
    outputSummary: 'CLI exited with code 1',
    reviewState: null,
    deliverables: [],
  }],
  edges: [],
  reviewEvents: [],
}

const failedRun: IssueRun = {
  id: 'run-1',
  issueId: 'issue-1',
  agentId: 'agent-1',
  status: 'failed',
  kind: 'agent_run',
  workspaceStrategy: 'scratch',
  startedAt: '2026-05-20T05:00:00Z',
  completedAt: '2026-05-20T05:05:00Z',
  output: '[auto-dispatched by pickup-ready sweep]\n[recovered after restart]\nCLI exited with code 1',
  errorMessage: 'CLI exited with code 1',
}

const recoveryEvent: IssueRunEventRow = {
  id: 'evt-1',
  runId: 'run-1',
  seq: 1,
  eventType: 'issue.run.metric',
  payload: { kind: 'recovery', message: 'Server restarted while this run was active' },
  createdAt: '2026-05-20T05:03:00Z',
}

function renderDag() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <IssueFlowDag projectId="project-1" issueId="issue-1" />
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  )
}

describe('IssueFlowDag', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    apiFetchMock.mockImplementation((url: string) => {
      if (url === '/api/projects/project-1/issues/issue-1/flow') {
        return Promise.resolve(failedFlow)
      }
      if (url === '/api/projects/project-1/issues/issue-1/runs') {
        return Promise.resolve([failedRun])
      }
      if (url === '/api/projects/project-1/issues/issue-1/runs/run-1/events?limit=100') {
        return Promise.resolve({ events: [recoveryEvent] })
      }
      return Promise.reject(new Error(`unexpected apiFetch URL: ${url}`))
    })
  })

  it('expands a failed default Work Pickup run into event-derived stages', async () => {
    renderDag()

    expect(await screen.findByText('Auto-started by scheduler')).toBeInTheDocument()
    expect(screen.getByText('Dispatch to worker')).toBeInTheDocument()
    expect(screen.getByText('Agent session')).toBeInTheDocument()
    expect(await screen.findByText('Recovered after restart')).toBeInTheDocument()
    expect(screen.getByText('Run failed')).toBeInTheDocument()
    expect(screen.getByText('Default Work Pickup path')).toBeInTheDocument()
    expect(screen.getByText(/scheduler → dispatch → agent → recovery → failed/)).toBeInTheDocument()
    expect(screen.getByTestId('flow-controls')).toBeInTheDocument()
    expect(screen.getAllByTestId('flow-node')).toHaveLength(5)
    expect(screen.queryByText('1 stage')).not.toBeInTheDocument()
  })

  it('shows a clearer empty state when no run evidence exists yet', async () => {
    apiFetchMock.mockImplementation((url: string) => {
      if (url === '/api/projects/project-1/issues/issue-1/flow') {
        return Promise.resolve({ ...failedFlow, stepRuns: [] })
      }
      if (url === '/api/projects/project-1/issues/issue-1/runs') {
        return Promise.resolve([])
      }
      return Promise.reject(new Error(`unexpected apiFetch URL: ${url}`))
    })

    renderDag()

    expect(await screen.findByText(/No run evidence yet/i)).toBeInTheDocument()
    expect(screen.getByText(/planned path and live checkpoints/i)).toBeInTheDocument()
  })
})

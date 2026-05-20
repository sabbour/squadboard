import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AgentDetailPanel from '../AgentDetailPanel.tsx'
import type { Agent } from '../../../api/agents.ts'

const apiMocks = vi.hoisted(() => ({
  useAgent: vi.fn(),
  updateMutate: vi.fn(),
  deletePermanentlyMutate: vi.fn(),
  updatePending: false,
  deletePending: false,
}))

vi.mock('../../../api/agents.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/agents.ts')>()
  return {
    ...actual,
    useAgent: (...args: unknown[]) => apiMocks.useAgent(...args),
    useUpdateAgent: () => ({
      mutate: apiMocks.updateMutate,
      isPending: apiMocks.updatePending,
    }),
    useDeleteAgentPermanently: () => ({
      mutate: apiMocks.deletePermanentlyMutate,
      isPending: apiMocks.deletePending,
    }),
  }
})

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    projectId: 'project-1',
    name: 'cosmo-kramer',
    role: 'Tester',
    model: null,
    status: 'retired',
    agentKind: 'squad',
    origin: 'project',
    readOnly: false,
    charterPath: '/workspace/.squad/agents/cosmo-kramer/charter.md',
    createdAt: '2026-05-19T12:00:00Z',
    updatedAt: '2026-05-19T12:00:00Z',
    ...overrides,
  }
}

describe('AgentDetailPanel lifecycle actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.useAgent.mockReturnValue({ data: undefined })
    apiMocks.updatePending = false
    apiMocks.deletePending = false
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('permanently deletes retired project agents after confirmation', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<AgentDetailPanel projectId="project-1" agent={agent()} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /delete agent/i }))

    expect(apiMocks.deletePermanentlyMutate).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    )

    const options = apiMocks.deletePermanentlyMutate.mock.calls[0]?.[1] as { onSuccess: () => void }
    options.onSuccess()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not delete when the user cancels the confirmation', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<AgentDetailPanel projectId="project-1" agent={agent()} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /delete agent/i }))

    expect(apiMocks.deletePermanentlyMutate).not.toHaveBeenCalled()
  })

  it('does not offer permanent delete for read-only virtual Copilot agents', () => {
    render(
      <AgentDetailPanel
        projectId="project-1"
        agent={agent({ agentKind: 'copilot', origin: 'virtual-copilot', readOnly: true })}
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: /delete agent/i })).not.toBeInTheDocument()
    expect(screen.getByText(/read-only roster entry/i)).toBeInTheDocument()
  })

  it('treats underscore agent folders as read-only overview entries', () => {
    render(
      <AgentDetailPanel
        projectId="project-1"
        agent={agent({
          id: 'legacy-alumni-row',
          name: '_alumni',
          charterPath: '/workspace/.squad/agents/_alumni/charter.md',
        })}
        onClose={vi.fn()}
      />,
    )

    expect(apiMocks.useAgent).toHaveBeenCalledWith('project-1', 'legacy-alumni-row', { enabled: false })
    expect(screen.queryByRole('button', { name: /charter/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /capabilities/i })).not.toBeInTheDocument()
    expect(screen.getByText(/internal \.squad\/agents housekeeping folder/i)).toBeInTheDocument()
  })
})

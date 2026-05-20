/**
 * RunButton regression test — W26
 *
 * Asserts that clicking "Run" calls startRun.mutate with the correct
 * agentId.  This test was introduced as part of the W26 regression fix to
 * prevent future footer-restructure changes from silently breaking the
 * Run action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RunButton from './RunButton'

// ── Mock API hooks ────────────────────────────────────────────────────────────

const mockMutate = vi.fn()

vi.mock('../../api/agents', () => ({
  useActiveAgents: () => ({
    data: [{ id: 'agent-fenster', name: 'Fenster', status: 'active' }],
    isLoading: false,
  }),
}))

vi.mock('../../api/runs', () => ({
  useIssueRuns: () => ({ data: [] }),
  useStartRun: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
  useCancelRun: () => ({ mutate: vi.fn() }),
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RunButton', () => {
  beforeEach(() => {
    mockMutate.mockReset()
  })

  it('renders the Run button with data-testid', () => {
    render(<RunButton projectId="proj-1" issueId="issue-1" />)
    expect(screen.getByTestId('task-run-button')).toBeInTheDocument()
    expect(screen.getByTestId('task-run-button')).toHaveTextContent('Run')
  })

  it('calls startRun.mutate with issueId and first agent id when clicked', async () => {
    const user = userEvent.setup()
    render(<RunButton projectId="proj-1" issueId="issue-1" />)

    const btn = screen.getByTestId('task-run-button')
    expect(btn).not.toBeDisabled()
    await user.click(btn)

    expect(mockMutate).toHaveBeenCalledOnce()
    expect(mockMutate).toHaveBeenCalledWith(
      { issueId: 'issue-1', agentId: 'agent-fenster' },
      expect.any(Object),
    )
  }, 20000)

  it('button is enabled with at least one active agent', () => {
    render(<RunButton projectId="proj-1" issueId="issue-2" />)
    const btn = screen.getByTestId('task-run-button')
    expect(btn).not.toBeDisabled()
    expect(btn).toHaveTextContent('Run')
  })
})

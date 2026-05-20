/**
 * ConjureModal.createIssue.test.tsx — W22 regression for "toast-on-number" bug
 *
 * Bug (reported 2026-05-19):
 *   In ConjureModal, showToast() stored the onUndo callback by casting the
 *   setTimeout return value (a number) to an object and writing a property on it:
 *
 *     ;(toastTimerRef.current as unknown as { onUndo?: () => void }).onUndo = onUndo
 *
 *   In strict mode (all ES-module code) this throws synchronously:
 *     "Cannot create property 'onUndo' on number '520'"
 *
 *   The error propagated up through handleLightCreate → handleSubmit's try/catch,
 *   was caught, and surfaced in the modal's error MessageBar instead of the
 *   success toast.  The user saw the error: "Cannot create property 'onUndo' on
 *   number '520'" right after clicking "Create Issue".
 *
 * Fix:
 *   A dedicated `undoCallbackRef = useRef<(() => void) | undefined>(undefined)` was
 *   added alongside the timer ref, and showToast now stores/reads the callback there.
 *
 * Repro path:
 *   1. Open Conjure modal with text "Blog post about how Squad enables creativity"
 *   2. "Issue · 29%" pill is selected (hint="issue" or classifier result)
 *   3. Click "Create Issue"  → showToast is called → TypeError throws → caught →
 *      error MessageBar shows instead of success toast.
 *
 * These tests protect against regression of that path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ── Mock react-router ─────────────────────────────────────────────────────────

const mockNavigate = vi.fn()

vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
}))

// ── Mock @tanstack/react-query ────────────────────────────────────────────────

const mockInvalidateQueries = vi.fn()

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

// ── Mock API hooks ────────────────────────────────────────────────────────────

const mockMutateAsync = vi.fn()

vi.mock('../../../api/issues', () => ({
  useCreateIssue: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}))

vi.mock('../../../api/inbox', () => ({
  useCreateInboxItem: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}))

vi.mock('../../../api/client', () => ({
  apiFetch: vi.fn(),
}))

// ── Import component under test (after all mocks) ────────────────────────────

import ConjureModal from '../ConjureModal.tsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROSE = 'Blog post about how Squad enables creativity'

function renderConjureModal(overrides: Record<string, unknown> = {}) {
  return render(
    <ConjureModal
      isOpen
      onClose={vi.fn()}
      hint="issue"
      initialProse={PROSE}
      projectId="proj-1"
      projectName="My Project"
      {...overrides}
    />,
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ConjureModal — Create Issue (W22 showToast regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMutateAsync.mockResolvedValue({ id: 'new-issue-1', title: PROSE })
    mockInvalidateQueries.mockResolvedValue(undefined)
  })

  it('does not surface the "Cannot create property onUndo on number" TypeError', async () => {
    const user = userEvent.setup()
    renderConjureModal()

    // hint="issue" auto-selects the issue intent; initialProse enables the button.
    const createBtn = await screen.findByRole('button', { name: /create issue/i })
    expect(createBtn).not.toBeDisabled()

    await user.click(createBtn)

    // The bug causes a TypeError that is caught by handleSubmit's try/catch and
    // displayed in the error MessageBar.  After the fix neither phrase should appear.
    await waitFor(() => {
      expect(screen.queryByText(/cannot create property/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/on number/i)).not.toBeInTheDocument()
    })
  })

  it('calls createIssue.mutateAsync exactly once with correct title/body', async () => {
    const user = userEvent.setup()
    renderConjureModal()

    const createBtn = await screen.findByRole('button', { name: /create issue/i })
    await user.click(createBtn)

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledOnce()
    })

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('Blog post') }),
    )
  })

  it('shows no error message in the modal after successful issue creation', async () => {
    const user = userEvent.setup()
    renderConjureModal()

    const createBtn = await screen.findByRole('button', { name: /create issue/i })
    await user.click(createBtn)

    // Give async handlers time to settle.
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled()
    })

    // No error MessageBar should be visible.
    expect(screen.queryByRole('group', { name: /error/i })).not.toBeInTheDocument()
  })

  it('Create Issue button is disabled when prose is empty', () => {
    renderConjureModal({ initialProse: '' })

    // The button renders but is disabled because canSubmit requires non-empty prose.
    // (This also confirms we rely on canSubmit, not just selectedIntent.)
    const createBtn = screen.getByRole('button', { name: /create issue/i })
    expect(createBtn).toBeDisabled()
  })
})

import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttachWorkflowModal } from '../AttachWorkflowModal.tsx'

const apiMocks = vi.hoisted(() => ({
  useCeremonies: vi.fn(),
  useCeremonyTemplates: vi.fn(),
  attachMutateAsync: vi.fn(),
  createMutateAsync: vi.fn(),
}))

vi.mock('../../../api/ceremonies.ts', () => ({
  useCeremonies: apiMocks.useCeremonies,
  useCeremonyTemplates: apiMocks.useCeremonyTemplates,
  useAttachCeremony: () => ({ mutateAsync: apiMocks.attachMutateAsync }),
  useCreateCeremony: () => ({ mutateAsync: apiMocks.createMutateAsync }),
}))

function mockRunPlanData() {
  apiMocks.useCeremonies.mockReturnValue({
    data: [
      { id: 'ceremony-1', name: 'Design Review', activeVersionId: 'version-review' },
      { id: 'ceremony-2', name: 'Draft without version', activeVersionId: null },
    ],
  })
  apiMocks.useCeremonyTemplates.mockReturnValue({
    data: [
      {
        slug: 'design-review',
        name: 'Design Review',
        description: 'Review architecture and UX before implementation.',
        yamlContent: 'name: design-review',
      },
      {
        slug: 'bug-triage',
        name: 'Bug Triage',
        description: 'Sort a bug into the right owner and next step.',
        yamlContent: 'name: bug-triage',
      },
    ],
  })
  apiMocks.attachMutateAsync.mockResolvedValue(undefined)
  apiMocks.createMutateAsync.mockResolvedValue({
    version: { id: 'created-version' },
  })
}

function arrangeModal(onClose = vi.fn()) {
  mockRunPlanData()

  return render(
    <AttachWorkflowModal
      projectId="project-1"
      issueId="issue-1"
      onClose={onClose}
    />,
  )
}

function arrangeStatefulModal() {
  mockRunPlanData()
  const onClose = vi.fn()

  function Harness() {
    const [open, setOpen] = useState(true)
    if (!open) return null

    return (
      <AttachWorkflowModal
        projectId="project-1"
        issueId="issue-1"
        onClose={() => {
          onClose()
          setOpen(false)
        }}
      />
    )
  }

  return { onClose, ...render(<Harness />) }
}

function getDialogBackdrop() {
  const dialog = screen.getByRole('dialog')
  const backdrop = Array.from(document.body.querySelectorAll<HTMLElement>('[aria-hidden="true"]'))
    .find((element) => !element.contains(dialog))

  if (!backdrop) {
    throw new Error('Expected dialog backdrop')
  }

  return backdrop
}

describe('AttachWorkflowModal run-plan override copy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('explains that choosing a plan overrides the default Work Pickup behavior', () => {
    arrangeModal()

    expect(screen.getByRole('heading', { name: 'Override default Work Pickup' })).toBeInTheDocument()
    expect(screen.getByText(/This card already uses Work Pickup when it enters Ready/i)).toBeInTheDocument()
    expect(screen.getByText('Use an existing project plan')).toBeInTheDocument()
    expect(screen.getByText(/instead of the default Work Pickup plan/i)).toBeInTheDocument()
    expect(screen.getByText('Create a new plan for this card')).toBeInTheDocument()
    expect(screen.getByText(/saves the new plan to this project and attaches it to this card/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use selected plan' })).toBeDisabled()
    expect(screen.queryByText('Create and use')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create from Design Review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create from Bug Triage' })).toBeInTheDocument()
  })

  it('keeps existing plan attachment wiring intact', async () => {
    const user = userEvent.setup()
    arrangeModal()

    await user.selectOptions(screen.getByRole('combobox'), 'version-review')
    await user.click(screen.getByRole('button', { name: 'Use selected plan' }))

    expect(apiMocks.attachMutateAsync).toHaveBeenCalledWith({ workflowVersionId: 'version-review' })
  })

  it('keeps the modal open while the project plan dropdown is interacting outside the surface', async () => {
    const user = userEvent.setup()
    const { onClose } = arrangeStatefulModal()

    const projectPlanDropdown = screen.getByRole('combobox', { name: 'Project run plan' })
    await user.click(projectPlanDropdown)
    fireEvent.click(getDialogBackdrop())

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Override default Work Pickup' })).toBeInTheDocument()

    await user.selectOptions(projectPlanDropdown, 'version-review')
    expect(projectPlanDropdown).toHaveValue('version-review')

    await user.click(screen.getByRole('button', { name: 'Use selected plan' }))

    expect(apiMocks.attachMutateAsync).toHaveBeenCalledWith({ workflowVersionId: 'version-review' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading', { name: 'Override default Work Pickup' })).not.toBeInTheDocument()
  })

  it('still closes from the explicit Cancel action', async () => {
    const user = userEvent.setup()
    const { onClose } = arrangeStatefulModal()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading', { name: 'Override default Work Pickup' })).not.toBeInTheDocument()
  })

  it('creates a project plan from a template before attaching it to the card', async () => {
    const user = userEvent.setup()
    arrangeModal()

    await user.click(screen.getByRole('button', { name: 'Create from Design Review' }))

    expect(apiMocks.createMutateAsync).toHaveBeenCalledWith({
      yamlContent: 'name: design-review',
      triggerKind: 'manual',
      triggerConfig: {},
      kind: 'workflow',
    })
    expect(apiMocks.attachMutateAsync).toHaveBeenCalledWith({ workflowVersionId: 'created-version' })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import ProjectPicker from '../ProjectPicker'
import type { Project } from '../../api/projects'

const apiMock = vi.hoisted(() => ({
  projectsQuery: {
    data: [] as Project[],
    isLoading: false,
    isError: false,
  },
  deleteMutation: {
    mutateAsync: vi.fn(),
    mutate: vi.fn(),
    isPending: false,
  },
  suggestMutation: {
    mutateAsync: vi.fn(),
    mutate: vi.fn(),
    isPending: false,
    error: null,
  },
}))

vi.mock('../../api/projects.ts', () => ({
  useProjects: () => apiMock.projectsQuery,
  useDeleteProject: () => apiMock.deleteMutation,
  useSuggestProjectSetup: () => apiMock.suggestMutation,
}))

function project(overrides: Partial<Project>): Project {
  return {
    id: 'project-1',
    name: 'Alpha App',
    squadPath: '/workspace/alpha/.squad',
    defaultModel: null,
    createdAt: '2026-05-18T12:00:00Z',
    ...overrides,
  }
}

function renderProjectPicker() {
  return render(
    <MemoryRouter>
      <ProjectPicker />
    </MemoryRouter>,
  )
}

describe('ProjectPicker persisted index controls', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    apiMock.projectsQuery.data = [
      project({ id: 'alpha', name: 'Alpha App', squadPath: '/workspace/alpha/.squad' }),
      project({ id: 'e2e', name: 'E2E Workspace', squadPath: '/workspace/.e2e-workspaces/e2e/.squad' }),
      project({ id: 'zeta', name: 'Zeta Tooling', squadPath: '/workspace/zeta/.squad' }),
    ]
    apiMock.projectsQuery.isLoading = false
    apiMock.projectsQuery.isError = false
    apiMock.deleteMutation.isPending = false
  })

  it('persists search, filter, and sort in browser-local preferences', async () => {
    const user = userEvent.setup()
    const { unmount } = renderProjectPicker()

    await user.type(screen.getByPlaceholderText('Search name or path'), 'work')
    await user.selectOptions(screen.getByRole('combobox', { name: /filter/i }), 'test')
    await user.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'path')

    expect(screen.getByText('E2E Workspace')).toBeInTheDocument()
    expect(screen.queryByText('Alpha App')).not.toBeInTheDocument()

    const stored = JSON.parse(localStorage.getItem('squadboard:prefs') ?? '{}') as {
      projectIndex?: { query?: string; filter?: string; sortBy?: string }
    }
    expect(stored.projectIndex).toEqual({ query: 'work', filter: 'test', sortBy: 'path' })

    unmount()
    renderProjectPicker()

    expect(screen.getByPlaceholderText('Search name or path')).toHaveValue('work')
    expect(screen.getByRole('combobox', { name: /filter/i })).toHaveValue('test')
    expect(screen.getByRole('combobox', { name: /sort/i })).toHaveValue('path')
    expect(screen.getByText('E2E Workspace')).toBeInTheDocument()
    expect(screen.queryByText('Alpha App')).not.toBeInTheDocument()
  })

  it('uses explicit project card badge labels', () => {
    apiMock.projectsQuery.data = [
      project({
        id: 'credits',
        name: 'Credits Project',
        squadPath: '/workspace/credits/.squad',
        costModel: 'gh_multipliers',
      }),
    ]

    renderProjectPicker()

    expect(screen.getByText('Local .squad folder')).toBeInTheDocument()
    expect(screen.queryByText('Costs: GitHub multipliers')).not.toBeInTheDocument()
    expect(screen.queryByText('.squad linked')).not.toBeInTheDocument()
    expect(screen.queryByText('Cost: AI credits')).not.toBeInTheDocument()
  })
})

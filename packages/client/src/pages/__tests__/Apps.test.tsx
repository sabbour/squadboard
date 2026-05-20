import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { MemoryRouter } from 'react-router'
import Apps from '../Apps'

const apiMock = vi.hoisted(() => ({
  apps: [] as Array<{
    bundleId: string
    name: string
    description: string
    version: string
    catalog: 'squadboard-app'
    kind: 'squadboard-app'
    tags?: string[]
    icon?: string
  }>,
  appsQuery: {
    isLoading: false,
    isError: false,
  },
  applyMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
  },
  githubMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
  },
}))

vi.mock('../../api/templates.ts', () => ({
  useSquadboardApps: () => ({
    data: apiMock.apps,
    isLoading: apiMock.appsQuery.isLoading,
    isError: apiMock.appsQuery.isError,
  }),
  useApplySquadboardApp: () => apiMock.applyMutation,
  useInstallSquadboardAppFromGithub: () => apiMock.githubMutation,
}))

function renderApps() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <Apps />
      </MemoryRouter>
    </FluentProvider>,
  )
}

describe('Apps page', () => {
  beforeEach(() => {
    apiMock.apps = []
    apiMock.appsQuery.isLoading = false
    apiMock.appsQuery.isError = false
    apiMock.applyMutation.mutateAsync.mockReset()
    apiMock.applyMutation.isPending = false
    apiMock.githubMutation.mutateAsync.mockReset()
    apiMock.githubMutation.isPending = false
  })

  it('names the surface Squadboard Apps and keeps Project Templates separate', () => {
    renderApps()

    expect(screen.getByRole('heading', { name: 'Squadboard Apps' })).toBeInTheDocument()
    expect(screen.getByText(/specific domain packages as new Squadboard projects/i)).toBeInTheDocument()
    expect(screen.getByText(/Project Templates stay under Projects -> Create from template/i)).toBeInTheDocument()
    expect(screen.getByText(/No local Squadboard Apps are available in this checkout yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/installed in this checkout/i)).not.toBeInTheDocument()
  })

  it('warns before installing a GitHub Squadboard App as a project', () => {
    renderApps()

    expect(screen.getByRole('heading', { name: 'Install from GitHub' })).toBeInTheDocument()
    expect(screen.getByText(/Squadboard clones the repo, reads the bundle, and creates a normal project/i)).toBeInTheDocument()
    expect(screen.getByText(/Only install Squadboard Apps from sources you trust/i)).toBeInTheDocument()
    expect(screen.getByText(/Unknown repos can add agent prompts/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install as project' })).toBeInTheDocument()
  })

  it('shows local Squadboard Apps without an installed-state action', () => {
    apiMock.apps = [{
      bundleId: 'squad-doc-review',
      name: 'Squad Doc Review',
      description: 'Review Squad documentation changes with maintainers, technical reviewers, and reader advocates.',
      version: '0.1.0',
      catalog: 'squadboard-app',
      kind: 'squadboard-app',
      tags: ['squad', 'docs'],
      icon: 'DOC',
    }]

    renderApps()

    expect(screen.getByText('Squad Doc Review')).toBeInTheDocument()
    expect(screen.queryByText('DOC')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Install as project' }).length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByRole('button', { name: /installed/i })).not.toBeInTheDocument()
  })
})

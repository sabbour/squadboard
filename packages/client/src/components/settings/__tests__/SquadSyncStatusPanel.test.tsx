import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SquadSyncStatusPanel } from '../SquadSyncStatusPanel'
import type { SquadSyncStatus } from '../../../api/squad'

const apiMock = vi.hoisted(() => ({
  statusQuery: {
    data: undefined as SquadSyncStatus | undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  repairMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
  },
}))

vi.mock('../../../api/squad.ts', () => ({
  useSquadSyncStatus: () => apiMock.statusQuery,
  useRepairSquadSync: () => apiMock.repairMutation,
}))

function serverStatus(overrides: Partial<SquadSyncStatus> = {}): SquadSyncStatus {
  return {
    contractVersion: 'squadboard.sdk-sync-ownership.v1',
    authority: {
      rawProvider: null,
      storageMode: 'postgresql',
      sourceOfTruth: 'squad_storage',
      sharedExternalAccess: 'hosted-postgresql-or-squadboard-broker',
      continuousSync: false,
      runtime: {
        kind: 'local-pglite',
        note: 'External clients must use Squadboard API/MCP rather than opening this DB directly.',
      },
    },
    storage: {
      squadStorage: {
        available: true,
        rowCount: 3,
        lastUpdatedAt: null,
      },
    },
    bootstrap: {
      status: 'ready',
      missingRequired: [],
      missingRecommended: [],
    },
    projection: {
      projectRoot: '/workspace/app',
      squadPath: '/workspace/app/.squad',
      artifacts: [
        {
          id: 'ceremoniesDefaultsPresent',
          path: '.squad/ceremonies.md#defaults',
          status: 'present',
          requirement: 'required',
          owner: 'squadboard',
          purpose: 'Seeded ceremony defaults must be present.',
        },
        {
          id: 'copilotAgentMd',
          path: '.github/agents/squad.agent.md',
          status: 'present',
          requirement: 'recommended',
          owner: 'copilot-cli',
          purpose: 'Copilot/CLI coordinator projection.',
        },
      ],
    },
    drift: {
      detected: false,
      level: 'ready',
      summary: 'No missing required or recommended projection artifacts detected.',
      issues: [],
      continuousSync: false,
    },
    repair: {
      dryRunSupported: true,
      actions: [],
    },
    ...overrides,
  }
}

describe('SquadSyncStatusPanel', () => {
  beforeEach(() => {
    apiMock.statusQuery.data = serverStatus()
    apiMock.statusQuery.isLoading = false
    apiMock.statusQuery.isError = false
    apiMock.statusQuery.isFetching = false
    apiMock.statusQuery.error = null
    apiMock.statusQuery.refetch.mockReset()
    apiMock.repairMutation.mutateAsync.mockReset()
    apiMock.repairMutation.isPending = false
  })

  it('shows peer-client readiness from the sync status contract', () => {
    render(<SquadSyncStatusPanel projectId="project-1" />)

    expect(screen.getByText('Ready for Squadboard ↔ CLI/Copilot')).toBeInTheDocument()
    expect(screen.getByText('Squadboard database')).toBeInTheDocument()
    expect(screen.getByText('PostgreSQL-backed')).toBeInTheDocument()
    expect(screen.getByText('CLI/Copilot agent file')).toBeInTheDocument()
  })

  it('calls repair for safe backend-reported actions', async () => {
    const user = userEvent.setup()
    apiMock.statusQuery.data = serverStatus({
      projection: {
        projectRoot: '/workspace/app',
        squadPath: '/workspace/app/.squad',
        artifacts: [
          {
            id: 'ceremoniesDefaultsPresent',
            path: '.squad/ceremonies.md#defaults',
            status: 'present',
            requirement: 'required',
            owner: 'squadboard',
          },
          {
            id: 'copilotAgentMd',
            path: '.github/agents/squad.agent.md',
            status: 'missing',
            requirement: 'recommended',
            owner: 'copilot-cli',
          },
        ],
      },
      drift: {
        detected: true,
        level: 'warning',
        summary: '1 sync health issue(s) detected.',
        issues: [{
          code: 'recommended_projection_missing',
          severity: 'warning',
          artifactId: 'copilotAgentMd',
          message: 'Recommended projection is missing: .github/agents/squad.agent.md',
        }],
        continuousSync: false,
      },
      repair: {
        dryRunSupported: true,
        actions: [
        {
          id: 'generate-github-agent',
          aliases: ['project-copilot-agent-file'],
          owner: 'Kobayashi',
          available: true,
          required: true,
          destructive: false,
          reason: 'Generate the CLI/Copilot projection from canonical Squad state.',
        },
        ],
      },
    })
    apiMock.repairMutation.mutateAsync.mockResolvedValue({
      results: [{ action: 'generate-github-agent', status: 'applied', reason: 'changes_applied' }],
    })

    render(<SquadSyncStatusPanel projectId="project-1" />)
    expect(screen.getByText('Usable, but CLI/Copilot needs repair')).toBeInTheDocument()

    await user.click(screen.getByTestId('repair-action-generate-github-agent'))

    expect(apiMock.repairMutation.mutateAsync).toHaveBeenCalledWith({
      actions: ['generate-github-agent'],
      dryRun: false,
    })
    expect(await screen.findByText(/Repair requested:/)).toBeInTheDocument()
  })

  it('keeps the panel visible when the status endpoint is unavailable', () => {
    apiMock.statusQuery.data = undefined
    apiMock.statusQuery.isError = true
    apiMock.statusQuery.error = new Error('API 404: route not found')

    render(<SquadSyncStatusPanel projectId="project-1" />)

    expect(screen.getByTestId('squad-sync-status-panel')).toBeInTheDocument()
    expect(screen.getByText('Status endpoint unavailable')).toBeInTheDocument()
    expect(screen.getByText(/Cross-client compatibility cannot be verified yet/)).toBeInTheDocument()
  })
})

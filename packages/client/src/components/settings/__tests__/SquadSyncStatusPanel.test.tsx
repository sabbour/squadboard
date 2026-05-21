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
        note: 'Squadboard stores project state; use Squadboard to keep connected tools aligned.',
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
    ceremonies: {
      status: 'ok',
      defaultsPresent: true,
      defaultsMissing: [],
      count: 7,
      filePath: '.squad/ceremonies.md',
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
      actions: [{
        id: 'project-squad-to-fs',
        owner: 'Keyser',
        available: true,
        required: false,
        destructive: false,
        reason: 'Export Squadboard state to .squad files.',
      }],
    },
    checkedAt: new Date().toISOString(),
    connected: true,
    onboardingSync: {
      inSync: true,
      connected: true,
      mcpConfigPresent: true,
      ceremoniesSeeded: true,
      squadAgentPresent: true,
      driftedFields: [],
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

  it('shows connected reconciliation state with a disconnect action', () => {
    render(<SquadSyncStatusPanel projectId="project-1" />)

    expect(screen.getAllByText('Squadboard is connected')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Disconnect from Squadboard' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Re-run setup' })).not.toBeInTheDocument()
    expect(screen.getByText(/Squadboard keeps your MCP config, ceremonies, and agent instructions in sync/i)).toBeInTheDocument()
    expect(screen.getByText(/currently aligned with Squadboard/i)).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-drift-list')).not.toBeInTheDocument()
    expect(screen.getByTestId('sync-diagnostics')).not.toHaveAttribute('open')
  })

  it('shows compact sync diagnostics with relative last-checked status', () => {
    render(<SquadSyncStatusPanel projectId="project-1" />)

    expect(screen.getByText('Sync Diagnostics')).toBeInTheDocument()
    expect(screen.getByTestId('sync-diagnostic-mcpConfigPresent')).toHaveTextContent('.mcp.json')
    expect(screen.getByTestId('sync-diagnostic-mcpConfigPresent')).toHaveTextContent('present')
    expect(screen.getByTestId('sync-diagnostic-ceremoniesSeeded')).toHaveTextContent('Built-in ceremonies')
    expect(screen.getByTestId('sync-diagnostic-ceremoniesSeeded')).toHaveTextContent('seeded (7)')
    expect(screen.getByTestId('sync-diagnostic-squadAgentPresent')).toHaveTextContent('squad.agent.md')
    expect(screen.getByText(/Last checked: just now/i)).toBeInTheDocument()
  })

  it('shows the primary connect CTA when not connected', () => {
    apiMock.statusQuery.data = serverStatus({
      connected: false,
      onboardingSync: {
        inSync: false,
        connected: false,
        mcpConfigPresent: false,
        ceremoniesSeeded: false,
        squadAgentPresent: false,
        driftedFields: [],
      },
    })

    render(<SquadSyncStatusPanel projectId="project-1" />)

    expect(screen.getByRole('button', { name: 'Connect to Squadboard' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disconnect from Squadboard' })).not.toBeInTheDocument()
    expect(screen.queryByText('Configuration drift detected')).not.toBeInTheDocument()
  })

  it('shows drift details with rerun and disconnect actions when connected but out of sync', () => {
    apiMock.statusQuery.data = serverStatus({
      connected: true,
      onboardingSync: {
        inSync: false,
        connected: true,
        mcpConfigPresent: false,
        ceremoniesSeeded: false,
        squadAgentPresent: true,
        driftedFields: ['mcpConfigPresent', 'ceremoniesSeeded'],
      },
    })

    render(<SquadSyncStatusPanel projectId="project-1" />)

    expect(screen.getAllByText('Configuration drift detected')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Re-run setup' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disconnect from Squadboard' })).toBeInTheDocument()
    const driftList = screen.getByTestId('onboarding-drift-list')
    expect(driftList).toHaveTextContent('`.mcp.json` is missing.')
    expect(driftList).toHaveTextContent('Ceremonies are not seeded.')
    expect(screen.getByTestId('sync-diagnostics')).toHaveAttribute('open')
    expect(screen.getByTestId('sync-diagnostic-mcpConfigPresent')).toHaveTextContent('missing')
    expect(screen.getByTestId('sync-diagnostic-ceremoniesSeeded')).toHaveTextContent('not seeded')
  })

  it('removes granular repair buttons and broker setup actions from the panel', () => {
    render(<SquadSyncStatusPanel projectId="project-1" />)

    expect(screen.queryByTestId('repair-action-project-squad-to-fs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('broker-setup-card')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configure Now' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Preview Export' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Preview Repair' })).not.toBeInTheDocument()
  })

  it('runs onboarding from the primary CTA and shows loading plus success feedback', async () => {
    const user = userEvent.setup()
    apiMock.statusQuery.data = serverStatus({
      connected: false,
      onboardingSync: {
        inSync: false,
        connected: false,
        mcpConfigPresent: false,
        ceremoniesSeeded: false,
        squadAgentPresent: false,
        driftedFields: ['mcpConfigPresent', 'ceremoniesSeeded', 'squadAgentPresent'],
      },
    })

    let resolveMutation: ((value: unknown) => void) | null = null
    apiMock.repairMutation.mutateAsync.mockImplementation(() => new Promise((resolve) => {
      resolveMutation = resolve
    }))

    render(<SquadSyncStatusPanel projectId="project-1" />)

    await user.click(screen.getByTestId('connect-to-squadboard-button'))

    expect(apiMock.repairMutation.mutateAsync).toHaveBeenCalledWith({
      actions: ['onboard-to-squadboard'],
      dryRun: false,
    })
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled()

    resolveMutation?.({ repaired: ['onboard-to-squadboard'] })

    expect(await screen.findByText('Squadboard connected: Connect to Squadboard.')).toBeInTheDocument()
    expect(apiMock.statusQuery.refetch).toHaveBeenCalled()
  })

  it('shows onboarding errors from the reconciliation CTA', async () => {
    const user = userEvent.setup()
    apiMock.statusQuery.data = serverStatus({
      connected: false,
      onboardingSync: {
        inSync: false,
        connected: false,
        mcpConfigPresent: false,
        ceremoniesSeeded: true,
        squadAgentPresent: true,
        driftedFields: ['mcpConfigPresent'],
      },
    })
    apiMock.repairMutation.mutateAsync.mockRejectedValue(new Error('Composite onboarding action not available yet'))

    render(<SquadSyncStatusPanel projectId="project-1" />)

    await user.click(screen.getByTestId('connect-to-squadboard-button'))

    expect(await screen.findByText('Composite onboarding action not available yet')).toBeInTheDocument()
  })

  it('disconnects from Squadboard and shows the preservation confirmation', async () => {
    const user = userEvent.setup()
    apiMock.repairMutation.mutateAsync.mockResolvedValue({ repaired: ['disconnect-squadboard'] })

    render(<SquadSyncStatusPanel projectId="project-1" />)

    await user.click(screen.getByTestId('disconnect-from-squadboard-button'))

    expect(apiMock.repairMutation.mutateAsync).toHaveBeenCalledWith({
      actions: ['disconnect-squadboard'],
      dryRun: false,
    })
    expect(await screen.findByText('Disconnected. MCP config removed. Ceremonies and history are preserved.')).toBeInTheDocument()
    expect(apiMock.statusQuery.refetch).toHaveBeenCalled()
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

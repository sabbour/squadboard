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

function databaseAuthorityWithoutMirror(): NonNullable<SquadSyncStatus['authority']> {
  return {
    rawProvider: null,
    storageMode: 'postgresql',
    sourceOfTruth: 'squad_storage',
    sharedExternalAccess: 'hosted-postgresql-or-squadboard-broker',
    continuousSync: false,
    runtime: {
      kind: 'local-pglite',
      note: 'Squadboard stores project state; use Preview Export when another tool needs .squad files.',
    },
  }
}

function localPgliteAuthority(): NonNullable<SquadSyncStatus['authority']> {
  return {
    rawProvider: null,
    storageMode: 'filesystem',
    sourceOfTruth: 'filesystem',
    sharedExternalAccess: 'direct-filesystem-access',
    continuousSync: false,
    runtime: {
      kind: 'local-pglite',
      note: 'Local PGlite keeps Squadboard data on this machine; MCP lets Copilot CLI talk to it safely.',
    },
  }
}

function manualExportRepair(
  reason = 'Preview Export updates .squad files for CLI/Copilot before file-based tools run.',
): NonNullable<SquadSyncStatus['repair']> {
  return {
    dryRunSupported: true,
    actions: [{
      id: 'project-squad-to-fs',
      owner: 'Keyser',
      available: true,
      required: false,
      destructive: false,
      reason,
    }],
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

  it('when database authority has no live filesystem mirror, shows user actions without provider jargon', () => {
    apiMock.statusQuery.data = serverStatus({
      authority: databaseAuthorityWithoutMirror(),
      repair: manualExportRepair(),
    })

    render(<SquadSyncStatusPanel projectId="project-1" />)

    const panel = screen.getByTestId('squad-sync-status-panel')
    expect(screen.getByText('Ready through Squadboard')).toBeInTheDocument()
    expect(panel).toHaveTextContent(/This project lives in Squadboard/i)
    expect(panel).toHaveTextContent(/CLI\/Copilot can keep working through Squadboard/i)
    expect(panel).toHaveTextContent(/Preview Export writes .squad files only when you want a filesystem handoff/i)
    expect(panel).not.toHaveTextContent(/SQUADBOARD_SQUAD_STORAGE_PROVIDER/i)
    expect(panel).not.toHaveTextContent(/\bstorage provider\b/i)
    expect(panel).not.toHaveTextContent(/MCP\/API broker/i)
    expect(panel).not.toHaveTextContent(/PostgreSQL/i)
    expect(panel).not.toHaveTextContent(/explicit bridge/i)
    expect(panel).not.toHaveTextContent(/magic "enable auto" switch/i)
    expect(panel).toHaveTextContent(/Preview Export/i)
    expect(panel).toHaveTextContent(/\.squad files/i)
    expect(screen.getByRole('button', { name: 'Preview Export' })).toBeInTheDocument()
    expect(screen.getByText('Squadboard')).toBeInTheDocument()
    expect(screen.getByText('Squadboard-managed')).toBeInTheDocument()
    expect(screen.getByText('CLI/Copilot agent file')).toBeInTheDocument()
  })

  it('still shows the PostgreSQL broker setup card when manual bridge mode is active', () => {
    apiMock.statusQuery.data = serverStatus({
      authority: databaseAuthorityWithoutMirror(),
      repair: manualExportRepair(),
    })

    render(<SquadSyncStatusPanel projectId="project-1" />)

    expect(screen.getByTestId('broker-setup-card')).toBeInTheDocument()
    expect(screen.getByText('Connect Copilot CLI via MCP broker')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Configure Now' })).toBeInTheDocument()
    expect(screen.getByText('Manual setup')).toBeInTheDocument()
    expect(screen.queryByText('squadboard init --write-mcp-config')).not.toBeInTheDocument()
  })


  it('renders the Connect Copilot CLI card in PGlite mode', () => {
    apiMock.statusQuery.data = serverStatus({
      authority: localPgliteAuthority(),
    })

    render(<SquadSyncStatusPanel projectId="project-1" />)

    expect(screen.getByTestId('broker-setup-card')).toBeInTheDocument()
    expect(screen.getByText('Connect Copilot CLI to this project')).toBeInTheDocument()
    expect(screen.getByText('Set up the MCP broker so Copilot CLI and agents can read and write to this project.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Configure Now' })).toBeInTheDocument()
  })

  it('does not render the PostgreSQL broker card in PGlite mode', async () => {
    const user = userEvent.setup()
    apiMock.statusQuery.data = serverStatus({
      authority: localPgliteAuthority(),
    })

    render(<SquadSyncStatusPanel projectId="project-1" />)

    expect(screen.queryByText('Connect Copilot CLI via MCP broker')).not.toBeInTheDocument()

    await user.click(screen.getByText('Manual setup'))

    expect(await screen.findByText('squadboard init --write-mcp-config')).toBeInTheDocument()
    expect(screen.queryByText(/SQUADBOARD_DEFAULT_PROJECT_ID/)).not.toBeInTheDocument()
  })

  it('configures the MCP broker from the card and shows success feedback', async () => {
    const user = userEvent.setup()
    apiMock.statusQuery.data = serverStatus({
      authority: databaseAuthorityWithoutMirror(),
      repair: manualExportRepair(),
    })
    apiMock.repairMutation.mutateAsync.mockResolvedValue({ repaired: ['write-mcp-config'] })

    render(<SquadSyncStatusPanel projectId="project-1" />)

    await user.click(screen.getByTestId('configure-broker-button'))

    expect(apiMock.repairMutation.mutateAsync).toHaveBeenCalledWith({
      actions: ['write-mcp-config'],
    })
    expect(await screen.findByText('MCP broker configured — restart Copilot CLI to pick it up.')).toBeInTheDocument()
  })

  it('shows broker configuration errors from the repair endpoint', async () => {
    const user = userEvent.setup()
    apiMock.statusQuery.data = serverStatus({
      authority: databaseAuthorityWithoutMirror(),
      repair: manualExportRepair(),
    })
    apiMock.repairMutation.mutateAsync.mockRejectedValue(new Error('Could not write .copilot/mcp-config.json'))

    render(<SquadSyncStatusPanel projectId="project-1" />)

    await user.click(screen.getByTestId('configure-broker-button'))

    expect(await screen.findByText('Could not write .copilot/mcp-config.json')).toBeInTheDocument()
  })

  it('hides the broker setup card when manual bridge mode is off', () => {
    apiMock.statusQuery.data = serverStatus({
      authority: {
        ...databaseAuthorityWithoutMirror(),
        continuousSync: true,
      },
    })

    render(<SquadSyncStatusPanel projectId="project-1" />)

    expect(screen.queryByTestId('broker-setup-card')).not.toBeInTheDocument()
  })

  it('reveals the manual setup fallback when expanded', async () => {
    const user = userEvent.setup()
    apiMock.statusQuery.data = serverStatus({
      authority: databaseAuthorityWithoutMirror(),
      repair: manualExportRepair(),
    })

    render(<SquadSyncStatusPanel projectId="project-1" />)

    await user.click(screen.getByText('Manual setup'))

    expect(await screen.findByText('squadboard init --write-mcp-config')).toBeInTheDocument()
    expect(screen.getByText(/SQUADBOARD_DEFAULT_PROJECT_ID/)).toBeInTheDocument()
  })

  it('when Preview Export reports only unchanged files, summarizes the no-op instead of dumping every unchanged path', async () => {
    const user = userEvent.setup()
    const unchangedPaths = [
      '.squad/team.md',
      '.squad/routing.md',
      '.squad/decisions.md',
      '.squad/ceremonies.md',
      '.squad/agents/keyser/history.md',
      '.squad/agents/kujan/history.md',
      '.squad/agents/redfoot/history.md',
      '.squad/.secret_key',
    ]
    apiMock.statusQuery.data = serverStatus({
      authority: databaseAuthorityWithoutMirror(),
      repair: manualExportRepair('Export .squad files for CLI/Copilot.'),
    })
    apiMock.repairMutation.mutateAsync.mockResolvedValue({
      results: [{
        action: 'project-squad-to-fs',
        status: 'skipped',
        reason: 'already_up_to_date',
        changes: unchangedPaths.map((path) => ({
          path,
          operation: 'write-file',
          status: 'already_up_to_date',
          reason: 'already_up_to_date',
        })),
      }],
    })

    render(<SquadSyncStatusPanel projectId="project-1" />)
    await user.click(screen.getByTestId('repair-action-project-squad-to-fs'))

    expect(apiMock.repairMutation.mutateAsync).toHaveBeenCalledWith({
      actions: ['project-squad-to-fs'],
      dryRun: true,
    })
    expect(await screen.findByRole('heading', { name: 'Preview Export' })).toBeInTheDocument()

    const changes = screen.getByTestId('preview-modal-changes')
    expect(changes).toHaveTextContent(/no files need updating|already up to date/i)
    expect(changes).not.toHaveTextContent(/already_up_to_date/)
    for (const path of unchangedPaths) {
      expect(changes).not.toHaveTextContent(path)
    }
  })

  it('labels CLI-first filesystem authority without PostgreSQL wording', () => {
    apiMock.statusQuery.data = serverStatus({
      authority: {
        rawProvider: 'fs',
        storageMode: 'filesystem',
        sourceOfTruth: 'filesystem',
        importBehavior: 'live-filesystem',
        mirrorBehavior: 'none',
        sharedExternalAccess: 'direct-filesystem-access',
        continuousSync: false,
        runtime: {
          kind: 'filesystem',
          note: 'Filesystem mode uses the real .squad/ directory as live authority.',
        },
      },
      storage: {
        squadStorage: null,
      },
      drift: {
        detected: false,
        level: 'ready',
        summary: 'No missing required or recommended projection artifacts detected.',
        issues: [],
        continuousSync: false,
      },
    })

    render(<SquadSyncStatusPanel projectId="project-1" />)

    expect(screen.getByText('Ready for Squadboard ↔ CLI/Copilot')).toBeInTheDocument()
    expect(screen.getAllByText('Filesystem .squad').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/PostgreSQL/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Squadboard-managed')).not.toBeInTheDocument()
  })

  it('previews safe backend-reported repair actions', async () => {
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
      results: [{
        action: 'generate-github-agent',
        status: 'dry-run',
        reason: 'dry_run_changes_available',
        changes: [{
          path: '.github/agents/squad.agent.md',
          operation: 'write-file',
          status: 'would-apply',
          reason: 'missing',
        }, {
          path: '.squad/.secret_key',
          operation: 'write-file',
          status: 'unchanged',
          reason: 'already_up_to_date',
        }],
      }],
    })

    render(<SquadSyncStatusPanel projectId="project-1" />)
    expect(screen.getByText('Usable, but CLI/Copilot needs repair')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview Repair' })).toBeInTheDocument()
    expect(screen.getByText(/Previews are safe/i)).toBeInTheDocument()

    await user.click(screen.getByTestId('repair-action-generate-github-agent'))

    expect(apiMock.repairMutation.mutateAsync).toHaveBeenCalledWith({
      actions: ['generate-github-agent'],
      dryRun: true,
    })

    // Modal should open with title and changes
    expect(await screen.findByRole('heading', { name: 'Preview Repair' })).toBeInTheDocument()
    expect(screen.getByText(/Repair preview requested:/)).toBeInTheDocument()
    expect(screen.getByText(/write-file .github\/agents\/squad.agent.md — would-apply/)).toBeInTheDocument()
    expect(screen.getByText(/1 unchanged file hidden/i)).toBeInTheDocument()
    expect(screen.queryByText(/\.squad\/\.secret_key/)).not.toBeInTheDocument()
    expect(screen.queryByText(/already_up_to_date/)).not.toBeInTheDocument()

    // Cancel and Repair buttons should be present
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repair' })).toBeInTheDocument()
  })

  it('closes the preview modal on Cancel without applying changes', async () => {
    const user = userEvent.setup()
    apiMock.statusQuery.data = serverStatus({
      drift: {
        detected: true,
        level: 'warning',
        summary: '1 issue detected.',
        issues: [],
        continuousSync: false,
      },
      repair: {
        dryRunSupported: true,
        actions: [{
          id: 'generate-github-agent',
          available: true,
          required: true,
          destructive: false,
          reason: 'Generate agent file.',
        }],
      },
    })
    apiMock.repairMutation.mutateAsync.mockResolvedValue({ results: [] })

    render(<SquadSyncStatusPanel projectId="project-1" />)
    await user.click(screen.getByTestId('repair-action-generate-github-agent'))
    expect(await screen.findByRole('heading', { name: 'Preview Repair' })).toBeInTheDocument()

    // Click Cancel
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    // Modal closes, no apply call was made
    expect(screen.queryByRole('heading', { name: 'Preview Repair' })).not.toBeInTheDocument()
    expect(apiMock.repairMutation.mutateAsync).toHaveBeenCalledTimes(1) // only the dry-run call
  })

  it('applies repair on Repair button click with dryRun:false and shows success', async () => {
    const user = userEvent.setup()
    apiMock.statusQuery.data = serverStatus({
      drift: {
        detected: true,
        level: 'warning',
        summary: '1 issue detected.',
        issues: [],
        continuousSync: false,
      },
      repair: {
        dryRunSupported: true,
        actions: [{
          id: 'generate-github-agent',
          available: true,
          required: true,
          destructive: false,
          reason: 'Generate agent file.',
        }],
      },
    })
    apiMock.repairMutation.mutateAsync
      .mockResolvedValueOnce({ results: [] }) // dry-run
      .mockResolvedValueOnce({ results: [{ action: 'generate-github-agent', status: 'applied' }] }) // apply

    render(<SquadSyncStatusPanel projectId="project-1" />)
    await user.click(screen.getByTestId('repair-action-generate-github-agent'))
    expect(await screen.findByRole('heading', { name: 'Preview Repair' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Repair' }))

    // Modal closes
    expect(screen.queryByRole('heading', { name: 'Preview Repair' })).not.toBeInTheDocument()

    // Apply mutation called with dryRun: false
    expect(apiMock.repairMutation.mutateAsync).toHaveBeenCalledWith({
      actions: ['generate-github-agent'],
      dryRun: false,
    })

    // Success message shown
    expect(await screen.findByText(/Repair applied:/)).toBeInTheDocument()

    // Status was refreshed
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

  it('primary view does not expose implementation jargon', () => {
    render(<SquadSyncStatusPanel projectId="project-1" />)
    const primary = screen.getByTestId('squad-sync-primary')
    expect(primary).not.toHaveTextContent(/projection gaps/i)
    expect(primary).not.toHaveTextContent(/Repair actions/i)
    expect(primary).not.toHaveTextContent(/Manual export actions/i)
    expect(primary).not.toHaveTextContent(/source of truth/i)
    expect(primary).not.toHaveTextContent(/Drift hashes/i)
    expect(primary).not.toHaveTextContent(/artifact gaps/i)
  })

  it('primary view answers the three cross-client questions', () => {
    apiMock.statusQuery.data = serverStatus({
      authority: databaseAuthorityWithoutMirror(),
      repair: manualExportRepair(),
    })
    render(<SquadSyncStatusPanel projectId="project-1" />)
    const primary = screen.getByTestId('squad-sync-primary')
    // Q1: Where does this project live?
    expect(primary).toHaveTextContent(/Lives in/i)
    // Q2: Can CLI/Copilot continue?
    expect(primary).toHaveTextContent(/CLI\/Copilot/i)
    // Q3: What to do next?
    expect(primary).toHaveTextContent(/Sync to CLI\/Copilot|Preview Export/i)
    expect(screen.getByRole('button', { name: 'Preview Export' })).toBeInTheDocument()
  })
})

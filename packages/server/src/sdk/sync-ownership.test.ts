import { describe, expect, it } from 'vitest';
import {
  buildSyncOwnershipStatus,
  resolveSyncStorageContract,
  SQUAD_SYNC_OWNERSHIP_CONTRACT_VERSION,
} from './sync-ownership.js';

describe('sync ownership contract', () => {
  it('treats unset and postgresql provider as PostgreSQL authority', () => {
    expect(resolveSyncStorageContract(null)).toMatchObject({
      mode: 'postgresql',
      authority: 'squad_storage',
      importBehavior: 'one-time-filesystem-import-when-empty',
      mirrorBehavior: 'none',
    });
    expect(resolveSyncStorageContract('postgresql').mode).toBe('postgresql');
  });

  it('treats fs, pglite, and unknown providers as filesystem authority', () => {
    expect(resolveSyncStorageContract('fs')).toMatchObject({
      mode: 'filesystem',
      authority: 'filesystem',
      importBehavior: 'live-filesystem',
      mirrorBehavior: 'none',
    });
    expect(resolveSyncStorageContract('pglite').mode).toBe('filesystem');
    expect(resolveSyncStorageContract('surprise').mode).toBe('filesystem');
  });

  it('does not fail bootstrap when only the Copilot agent projection is missing', () => {
    const status = buildSyncOwnershipStatus({
      storageProvider: 'postgresql',
      projectRoot: '/repo',
      squadPath: '/repo/.squad',
      presence: {
        squadDir: true,
        agentsDir: true,
        decisionsInboxDir: true,
        teamMd: true,
        routingMd: true,
        decisionsMd: true,
        ceremoniesMd: true,
        copilotAgentMd: false,
      },
    });

    expect(status.contractVersion).toBe(SQUAD_SYNC_OWNERSHIP_CONTRACT_VERSION);
    expect(status.bootstrap.status).toBe('ready');
    expect(status.bootstrap.missingRequired).toEqual([]);
    expect(status.bootstrap.missingRecommended).toContain('copilotAgentMd');
    expect(status.repairActions.map((action) => action.id)).toContain('project-copilot-agent-file');
  });

  it('reports partial bootstrap when required .squad artifacts are missing', () => {
    const status = buildSyncOwnershipStatus({
      presence: {
        squadDir: true,
        agentsDir: false,
        teamMd: true,
        routingMd: false,
        decisionsMd: true,
      },
    });

    expect(status.bootstrap.status).toBe('partial');
    expect(status.bootstrap.missingRequired).toEqual(['agentsDir', 'routingMd']);
    expect(status.repairActions.map((action) => action.id)).toContain('repair-scaffold-squad');
  });

  it('names surface ownership without assigning DB/API behavior to the SDK', () => {
    const status = buildSyncOwnershipStatus();
    const sdkSurface = status.surfaces.find((surface) => surface.surface === 'squad-sdk');
    const squadboardSurface = status.surfaces.find((surface) => surface.surface === 'squadboard');

    expect(sdkSurface?.owns).toContain('StorageProvider and SquadState collection contracts');
    expect(sdkSurface?.doesNotOwn).toContain('Squadboard database schema, API routes, or board behavior');
    expect(squadboardSurface?.owns).toContain('Agent DB sync, MCP capture, workflow runs, and board state');
  });
});

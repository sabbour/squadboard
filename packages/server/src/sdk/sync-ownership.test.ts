import { describe, expect, it } from 'vitest';
import {
  describeCopilotAgentProjectionRequirement,
  renderCopilotAgentProjection,
  SQUAD_COPILOT_AGENT_PROJECTION_PATH,
} from './copilot-agent-projection.js';
import {
  buildSyncOwnershipStatus,
  resolveSyncStorageContract,
  SQUAD_CLIENT_ARTIFACT_CONTRACT_VERSION,
  SQUAD_SYNC_OWNERSHIP_CONTRACT_VERSION,
  toSquadSyncApiStatus,
  type SquadSyncProjectionPresence,
} from './sync-ownership.js';

const completePresence: Required<SquadSyncProjectionPresence> = {
  squadDir: true,
  agentsDir: true,
  decisionsInboxDir: true,
  teamMd: true,
  routingMd: true,
  decisionsMd: true,
  ceremoniesMd: true,
  ceremoniesDefaultsPresent: true,
  copilotAgentMd: true,
};

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

  it('represents Squadboard-first projects that are missing the Copilot agent projection', () => {
    const status = buildSyncOwnershipStatus({
      storageProvider: 'postgresql',
      projectRoot: '/repo',
      squadPath: '/repo/.squad',
      presence: {
        ...completePresence,
        copilotAgentMd: false,
      },
    });

    expect(status.contractVersion).toBe(SQUAD_SYNC_OWNERSHIP_CONTRACT_VERSION);
    expect(status.clientArtifactContractVersion).toBe(SQUAD_CLIENT_ARTIFACT_CONTRACT_VERSION);
    expect(status.bootstrap.status).toBe('ready');
    expect(status.bootstrap.missingRequired).toEqual([]);
    expect(status.projection.missing.recommended).toContain('copilotAgentMd');
    expect(status.clients.squadboard.status).toBe('ready');
    expect(status.clients.copilotCli).toMatchObject({
      status: 'blocked',
      authority: 'squad_storage',
      writeTarget: 'squadboard-mcp-api-broker',
      blockers: ['copilotAgentMd'],
    });
    expect(status.repairActions.map((action) => action.id)).toContain('generate-client-artifact');

    const apiStatus = toSquadSyncApiStatus(status, {
      projectId: 'project-1',
      checkedAt: '2026-05-19T21:58:16.699-07:00',
      databaseRuntime: 'postgresql',
      repairEndpoint: '/api/projects/project-1/squad-sync/repair',
    });
    expect(apiStatus.summary.status).toBe('partial');
    expect(apiStatus.sourceOfTruth).toBe('squad_storage');
    expect(apiStatus.repair.actions).toContain('agent_files');
  });

  it('represents CLI/Copilot-first filesystem authority connected to Squadboard', () => {
    const status = buildSyncOwnershipStatus({
      storageProvider: 'fs',
      projectRoot: '/repo',
      squadPath: '/repo/.squad',
      presence: completePresence,
    });

    expect(status.authority).toMatchObject({
      sourceOfTruth: 'filesystem',
      squadboardWriteTarget: 'filesystem',
      copilotCliWriteTarget: 'filesystem',
    });
    expect(status.projection.missing).toEqual({
      required: [],
      recommended: [],
      optional: [],
    });
    expect(status.clients.squadboard.status).toBe('ready');
    expect(status.clients.copilotCli.status).toBe('ready');
    expect(status.repairActions).toEqual([]);

    const apiStatus = toSquadSyncApiStatus(status, {
      projectId: 'project-2',
      checkedAt: '2026-05-19T21:58:16.699-07:00',
      databaseRuntime: 'none',
    });
    expect(apiStatus.summary.status).toBe('ok');
    expect(apiStatus.sourceOfTruth).toBe('filesystem');
    expect(apiStatus.storageMode).toBe('filesystem');
    expect(apiStatus.repair.available).toBe(false);
  });

  it('reports partial bootstrap when required .squad artifacts are missing', () => {
    const status = buildSyncOwnershipStatus({
      presence: {
        ...completePresence,
        agentsDir: false,
        routingMd: false,
      },
    });

    expect(status.bootstrap.status).toBe('partial');
    expect(status.bootstrap.missingRequired).toEqual(['agentsDir', 'routingMd']);
    expect(status.repairActions.map((action) => action.id)).toContain('repair-scaffold-squad');
  });

  it('treats missing or default-empty ceremonies as a required repair item', () => {
    const status = buildSyncOwnershipStatus({
      presence: {
        ...completePresence,
        ceremoniesDefaultsPresent: false,
      },
    });

    const ceremoniesArtifact = status.projection.artifacts.find(
      (artifact) => artifact.id === 'ceremoniesDefaultsPresent',
    );

    expect(status.bootstrap.status).toBe('partial');
    expect(status.bootstrap.missingRequired).toEqual(['ceremoniesDefaultsPresent']);
    expect(ceremoniesArtifact).toMatchObject({
      requirement: 'required',
      status: 'missing',
    });
    expect(status.repairActions.map((action) => action.id)).toContain('seed-ceremony-defaults');
    expect(status.repairActions.map((action) => action.id)).not.toContain('repair-scaffold-squad');
  });

  it('describes and renders the Copilot agent projection without writing files', () => {
    const requirement = describeCopilotAgentProjectionRequirement({
      authority: 'squad_storage',
      mcpBrokerName: 'Squadboard MCP',
    });

    expect(requirement).toMatchObject({
      contractVersion: SQUAD_CLIENT_ARTIFACT_CONTRACT_VERSION,
      artifactId: 'copilotAgentMd',
      path: SQUAD_COPILOT_AGENT_PROJECTION_PATH,
      authorityMode: 'squad_storage',
      repairAction: 'generate-client-artifact',
      preservesUserContentOutsideSentinels: true,
    });
    expect(requirement.writeGuidance).toContain('Squadboard MCP');
    expect(requirement.requiredSections).toContain('active authority mode');

    const rendered = renderCopilotAgentProjection({
      authority: 'filesystem',
      projectName: 'Interchangeable Squad',
      sourceHash: 'sha256:abc',
    });
    expect(rendered).toContain(SQUAD_CLIENT_ARTIFACT_CONTRACT_VERSION);
    expect(rendered).toContain('Interchangeable Squad');
    expect(rendered).toContain('Authority mode: `filesystem`');
    expect(rendered).toContain('source-hash: sha256:abc');
    expect(rendered).toContain('not the source of truth');
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

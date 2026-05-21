import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { projectRows, poolQueryMock } = vi.hoisted(() => ({
  projectRows: [] as Array<{ squadPath: string; storageProviderMode?: string | null }>,
  poolQueryMock: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => projectRows,
        }),
      }),
    }),
  }),
  getPool: () => ({ query: poolQueryMock }),
}));

import { getProjectSyncOwnershipStatus } from '../services/sdk-state.js';

const scratchRoot = fileURLToPath(
  new URL('../../.squad/test-runs/squad-sync-authority/', import.meta.url),
);

let previousStorageProvider: string | undefined;

async function writeFile(targetPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, 'utf-8');
}

async function createSquadFixture(
  name: string,
  options: {
    ceremonies?: string;
    includeCopilotProjection?: boolean;
  } = {},
): Promise<{ projectRoot: string; squadPath: string }> {
  const projectRoot = path.join(scratchRoot, name);
  const squadPath = path.join(projectRoot, '.squad');

  await fs.mkdir(path.join(squadPath, 'agents'), { recursive: true });
  await fs.mkdir(path.join(squadPath, 'decisions', 'inbox'), { recursive: true });
  await writeFile(path.join(squadPath, 'team.md'), '# Team\n');
  await writeFile(path.join(squadPath, 'routing.md'), '# Routing\n');
  await writeFile(path.join(squadPath, 'decisions.md'), '# Decisions\n');
  await writeFile(
    path.join(squadPath, 'ceremonies.md'),
    options.ceremonies ?? '# Ceremonies\n\n- Daily standup: review active work.\n',
  );

  if (options.includeCopilotProjection !== false) {
    await writeFile(
      path.join(projectRoot, '.github', 'agents', 'squad.agent.md'),
      '# Squad coordinator projection\n',
    );
  }

  return { projectRoot, squadPath };
}

describe('squad sync authority status', () => {
  beforeEach(async () => {
    previousStorageProvider = process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
    projectRows.length = 0;
    poolQueryMock.mockReset();
    poolQueryMock.mockResolvedValue({ rows: [{ row_count: '0' }] });
    await fs.rm(scratchRoot, { recursive: true, force: true });
    await fs.mkdir(scratchRoot, { recursive: true });
  });

  afterEach(async () => {
    if (previousStorageProvider === undefined) {
      delete process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
    } else {
      process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'] = previousStorageProvider;
    }
    projectRows.length = 0;
    poolQueryMock.mockReset();
    await fs.rm(scratchRoot, { recursive: true, force: true });
  });

  it('invariant: CLI/Copilot-first filesystem authority is reported as live filesystem authority', async () => {
    const { projectRoot, squadPath } = await createSquadFixture('cli-copilot-first');
    projectRows.push({ squadPath });
    process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'] = 'fs';

    const status = await getProjectSyncOwnershipStatus('project-fs');

    expect(status.storage).toMatchObject({
      rawProvider: 'fs',
      mode: 'filesystem',
      authority: 'filesystem',
      importBehavior: 'live-filesystem',
      sharedExternalAccess: 'direct-filesystem-access',
    });
    expect(status.projection).toMatchObject({ projectRoot, squadPath });
    expect(status.bootstrap).toMatchObject({
      status: 'ready',
      missingRequired: [],
      missingRecommended: [],
    });
    expect(JSON.stringify(status.storage)).not.toContain('squad_storage');
  });

  it('invariant: legacy CLI/Copilot-first rows stay filesystem authority when DB has not imported state', async () => {
    const { projectRoot, squadPath } = await createSquadFixture('legacy-cli-first');
    projectRows.push({ squadPath, storageProviderMode: null });
    delete process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
    poolQueryMock.mockResolvedValue({ rows: [{ row_count: '0' }] });

    const status = await getProjectSyncOwnershipStatus('project-legacy-fs');

    expect(poolQueryMock).toHaveBeenCalledWith(
      'SELECT COUNT(*) AS row_count FROM squad_storage WHERE scope = $1',
      ['project-legacy-fs'],
    );
    expect(status.storage).toMatchObject({
      rawProvider: 'fs',
      mode: 'filesystem',
      authority: 'filesystem',
      importBehavior: 'live-filesystem',
    });
    expect(status.projection).toMatchObject({ projectRoot, squadPath });
    expect(JSON.stringify(status.storage)).not.toContain('squad_storage');
  });

  it('invariant: legacy projects with imported DB rows report squad_storage authority', async () => {
    const { squadPath } = await createSquadFixture('legacy-db-imported');
    projectRows.push({ squadPath, storageProviderMode: null });
    delete process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];
    poolQueryMock.mockResolvedValue({ rows: [{ row_count: '7' }] });

    const status = await getProjectSyncOwnershipStatus('project-imported');

    expect(status.storage).toMatchObject({
      rawProvider: 'postgresql',
      mode: 'postgresql',
      authority: 'squad_storage',
      importBehavior: 'one-time-filesystem-import-when-empty',
    });
  });

  it('invariant: Squadboard-first missing Copilot projection is repairable, not unusable', async () => {
    const { squadPath } = await createSquadFixture('squadboard-first', {
      includeCopilotProjection: false,
    });
    projectRows.push({ squadPath, storageProviderMode: 'postgresql' });
    delete process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'];

    const status = await getProjectSyncOwnershipStatus('project-db');

    expect(status.storage).toMatchObject({
      mode: 'postgresql',
      authority: 'squad_storage',
    });
    expect(status.bootstrap.status).toBe('ready');
    expect(status.bootstrap.missingRequired).toEqual([]);
    expect(status.bootstrap.missingRecommended).toEqual(['copilotAgentMd']);
    expect(status.repairActions).toContainEqual(expect.objectContaining({
      id: 'generate-client-artifact',
      owner: 'Kobayashi',
      legacyIds: ['project-copilot-agent-file'],
    }));
  });

  it('invariant: empty/default ceremonies are a required repair item', async () => {
    const { squadPath } = await createSquadFixture('empty-ceremonies', {
      ceremonies: 'Project ceremonies will be listed here.\n',
    });
    projectRows.push({ squadPath });

    const status = await getProjectSyncOwnershipStatus('project-ceremonies');

    expect(status.bootstrap).toMatchObject({
      status: 'partial',
      missingRequired: ['ceremoniesDefaultsPresent'],
    });
    expect(status.repairActions).toContainEqual(expect.objectContaining({
      id: 'seed-ceremony-defaults',
      owner: 'Hockney',
    }));
    expect(status.repairActions).toContainEqual(expect.objectContaining({
      id: 'import-ceremonies-from-md',
      owner: 'Hockney',
    }));
  });
});

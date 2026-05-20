import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { projectRows } = vi.hoisted(() => ({
  projectRows: [] as Array<{ squadPath: string }>,
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
  getPool: vi.fn(() => {
    throw new Error('getPool must not be used by sync status tests');
  }),
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

  it('invariant: Squadboard-first missing Copilot projection is repairable, not unusable', async () => {
    const { squadPath } = await createSquadFixture('squadboard-first', {
      includeCopilotProjection: false,
    });
    projectRows.push({ squadPath });
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
  });
});

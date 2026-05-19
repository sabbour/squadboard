import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mockState = vi.hoisted(() => ({
  validCharter: `# valid-agent

## Role

Developer
`,
  agents: [] as Array<Record<string, unknown>>,
  updatePayloads: [] as Array<Record<string, unknown>>,
  insertPayloads: [] as Array<Record<string, unknown>>,
}));

vi.mock('../db/index.js', async () => {
  const schema = await import('../db/schema.js');

  const selectResult = () => ({
    limit: async (count: number) => mockState.agents.slice(0, count),
    then: <TResult1 = Array<Record<string, unknown>>, TResult2 = never>(
      onfulfilled?: ((value: Array<Record<string, unknown>>) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(mockState.agents).then(onfulfilled, onrejected),
  });

  const db = {
    select: () => ({
      from: () => ({
        where: () => selectResult(),
      }),
    }),
    insert: () => ({
      values: async (payload: Record<string, unknown>) => {
        mockState.insertPayloads.push(payload);
        return [];
      },
    }),
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        mockState.updatePayloads.push(payload);
        return {
          where: async () => [],
        };
      },
    }),
  };

  return {
    getDb: () => db,
    schema,
  };
});

vi.mock('../services/sdk-state.js', () => ({
  getAgents: async () => ({
    list: async () => ['valid-agent'],
    get: (agentName: string) => ({
      charter: async () => {
        if (agentName === 'valid-agent') return mockState.validCharter;
        throw new Error(`SDK skipped unparsable charter for ${agentName}`);
      },
    }),
  }),
}));

import { syncAgentsFromDisk } from '../services/agent-sync.js';

const projectId = '00000000-0000-4000-8000-000000000001';
const squadPath = fileURLToPath(
  new URL('../../.squad/test-runs/agent-sync-retired-regression/', import.meta.url),
);

async function writeAgentFixture(agentName: string, charterContent: string): Promise<string> {
  const agentDir = path.join(squadPath, 'agents', agentName);
  const charterPath = path.join(agentDir, 'charter.md');
  const historyPath = path.join(agentDir, 'history.md');

  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(charterPath, charterContent, 'utf8');
  await fs.writeFile(historyPath, `# ${agentName} — History\n`, 'utf8');

  return charterPath;
}

describe('agent-sync retired regression', () => {
  beforeEach(async () => {
    await fs.rm(squadPath, { recursive: true, force: true });

    mockState.updatePayloads = [];
    mockState.insertPayloads = [];

    const validCharterPath = await writeAgentFixture('valid-agent', mockState.validCharter);
    const freshHireCharterPath = await writeAgentFixture(
      'fresh-hire',
      'this charter shape is intentionally not understood by the SDK list parser',
    );
    const now = new Date('2026-05-19T14:38:22.590-07:00');

    mockState.agents = [
      {
        id: '00000000-0000-4000-8000-000000000101',
        projectId,
        name: 'valid-agent',
        role: 'Developer',
        model: null,
        status: 'active',
        charterPath: validCharterPath,
        historyPath: path.join(squadPath, 'agents', 'valid-agent', 'history.md'),
        charterHash: null,
        charterContent: mockState.validCharter,
        agentKind: 'squad',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '00000000-0000-4000-8000-000000000102',
        projectId,
        name: 'fresh-hire',
        role: 'Tester',
        model: null,
        status: 'active',
        charterPath: freshHireCharterPath,
        historyPath: path.join(squadPath, 'agents', 'fresh-hire', 'history.md'),
        charterHash: null,
        charterContent: '',
        agentKind: 'squad',
        createdAt: now,
        updatedAt: now,
      },
    ];
  });

  afterEach(async () => {
    await fs.rm(squadPath, { recursive: true, force: true });
  });

  it('does not retire a newly hired agent when SDK listing skips its charter but the folder still exists', async () => {
    const result = await syncAgentsFromDisk(projectId, squadPath);

    expect(result.removed).toBe(0);
    expect(mockState.updatePayloads).not.toContainEqual(
      expect.objectContaining({ status: 'retired' }),
    );
  });
});

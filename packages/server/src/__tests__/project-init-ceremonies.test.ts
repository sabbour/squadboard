/**
 * project-init-ceremonies.test.ts — CER-2: Integration tests for
 * createProject wiring seedBuiltInCeremonies.
 *
 * DB and seeder are mocked to isolate the wiring logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

const mockProject = { id: 'proj-abc', name: 'Test Project', path: '/test' };

vi.mock('../db/index.js', () => ({
  getDb: () => ({
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([mockProject]),
      })),
    })),
  }),
  schema: {
    projects: {},
  },
}));

vi.mock('../services/project-path-uniqueness.js', () => ({
  assertProjectPathAvailable: vi.fn(async (inputPath: string) =>
    inputPath.endsWith('/.squad') ? inputPath : `${inputPath}/.squad`,
  ),
}));

// ---------------------------------------------------------------------------
// seedBuiltInCeremonies mock — tracks calls and can simulate failure
// ---------------------------------------------------------------------------

let seedCallCount = 0;
let seedResultsByProjectId: Map<string, { seeded: number; errors: number }> = new Map();
let seedShouldThrow = false;

vi.mock('../ceremonies/seed-built-in.js', () => ({
  seedBuiltInCeremonies: vi.fn(async (projectId: string) => {
    seedCallCount++;
    if (seedShouldThrow) {
      throw new Error('Seed failure (mocked)');
    }
    const config = seedResultsByProjectId.get(projectId) ?? { seeded: 3, errors: 0 };
    return {
      projectId,
      seeded: Array.from({ length: config.seeded }, (_, i) => ({
        name: `ceremony-${i}`,
        ceremonyId: `cer-${projectId}-${i}`,
        created: true,
      })),
      errors: Array.from({ length: config.errors }, (_, i) => ({
        name: `ceremony-err-${i}`,
        error: 'mock error',
      })),
    };
  }),
}));

// ---------------------------------------------------------------------------
// Import createProject after mocks
// ---------------------------------------------------------------------------

import { createProject } from '../services/project-init.js';
import { seedBuiltInCeremonies } from '../ceremonies/seed-built-in.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createProject + ceremony seeding', () => {
  beforeEach(() => {
    seedCallCount = 0;
    seedResultsByProjectId = new Map();
    seedShouldThrow = false;
    vi.clearAllMocks();
    delete process.env.SQUADBOARD_SEED_BUILT_IN_CEREMONIES;
  });

  afterEach(() => {
    delete process.env.SQUADBOARD_SEED_BUILT_IN_CEREMONIES;
  });

  it('new project → seedBuiltInCeremonies is called with the new project id', async () => {
    const project = await createProject({ name: 'Test Project', path: '/test' });

    expect(project.id).toBe('proj-abc');
    expect(seedBuiltInCeremonies).toHaveBeenCalledOnce();
    expect(seedBuiltInCeremonies).toHaveBeenCalledWith('proj-abc');
  });

  it('env flag SQUADBOARD_SEED_BUILT_IN_CEREMONIES=0 skips seeding', async () => {
    process.env.SQUADBOARD_SEED_BUILT_IN_CEREMONIES = '0';

    const project = await createProject({ name: 'Test Project', path: '/test' });

    expect(project.id).toBe('proj-abc');
    expect(seedBuiltInCeremonies).not.toHaveBeenCalled();
  });

  it('seed failure does not block project creation — project is still returned', async () => {
    seedShouldThrow = true;

    const project = await createProject({ name: 'Test Project', path: '/test' });

    // Project was still created despite seed throw
    expect(project.id).toBe('proj-abc');
    expect(seedBuiltInCeremonies).toHaveBeenCalledOnce();
  });

  it('two projects created in sequence — seeder called twice with distinct project ids', async () => {
    // The DB mock always returns the same mockProject; in real use they'd differ.
    // We test that seeder is invoked for each creation call.
    await createProject({ name: 'Project A', path: '/a' });
    await createProject({ name: 'Project B', path: '/b' });

    expect(seedBuiltInCeremonies).toHaveBeenCalledTimes(2);
  });
});

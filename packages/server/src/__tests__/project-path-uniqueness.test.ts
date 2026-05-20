import { beforeEach, describe, expect, it, vi } from 'vitest';

let projectRows: Array<{ id: string; name: string; path: string }> = [];

vi.mock('../db/index.js', () => ({
  getDb: () => ({
    select: vi.fn(() => ({
      from: vi.fn(() => projectRows),
    })),
  }),
  schema: {
    projects: {
      id: 'projects.id',
      name: 'projects.name',
      path: 'projects.path',
    },
  },
}));

const { assertProjectPathAvailable, findProjectBySquadPath } = await import(
  '../services/project-path-uniqueness.js'
);

describe('project path uniqueness', () => {
  beforeEach(() => {
    projectRows = [];
  });

  it('normalizes project folders to their .squad directory', async () => {
    await expect(assertProjectPathAvailable('/tmp/example-project')).resolves.toBe('/tmp/example-project/.squad');
  });

  it('detects duplicate folder paths after canonicalization', async () => {
    projectRows = [
      { id: 'project-1', name: 'Existing Project', path: '/tmp/example-project/.squad' },
    ];

    const owner = await findProjectBySquadPath('/tmp/example-project');
    expect(owner?.id).toBe('project-1');

    await expect(assertProjectPathAvailable('/tmp/example-project')).rejects.toMatchObject({
      status: 409,
      code: 'duplicate_project_path',
      projectId: 'project-1',
    });
  });

  it('allows a project to keep its own path during updates', async () => {
    projectRows = [
      { id: 'project-1', name: 'Existing Project', path: '/tmp/example-project/.squad' },
    ];

    await expect(
      assertProjectPathAvailable('/tmp/example-project', { excludeProjectId: 'project-1' }),
    ).resolves.toBe('/tmp/example-project/.squad');
  });
});

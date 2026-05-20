import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const handlers: Record<string, Record<string, Function>> = {};

const { insertedProjects, linkProjectToSquadMock } = vi.hoisted(() => ({
  insertedProjects: [] as Array<{ id: string; name: string; path: string }>,
  linkProjectToSquadMock: vi.fn(),
}));

vi.mock('express', () => ({
  Router: () => ({
    get: vi.fn((routePath: string, ...fns: Function[]) => {
      handlers['GET'] ??= {};
      handlers['GET'][routePath] = fns[fns.length - 1]!;
    }),
    post: vi.fn((routePath: string, ...fns: Function[]) => {
      handlers['POST'] ??= {};
      handlers['POST'][routePath] = fns[fns.length - 1]!;
    }),
  }),
}));

vi.mock('../db/index.js', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
    insert: () => ({
      values: (payload: { name: string; path: string }) => ({
        returning: async () => {
          const project = {
            id: `project-${insertedProjects.length + 1}`,
            name: payload.name,
            path: payload.path,
          };
          insertedProjects.push(project);
          return [project];
        },
      }),
    }),
  }),
  schema: {
    projects: {
      id: 'projects.id',
      path: 'projects.path',
    },
  },
}));

vi.mock('../services/project-squad.js', () => ({
  linkProjectToSquad: (...args: unknown[]) => linkProjectToSquadMock(...args),
}));

vi.mock('../services/project-path-uniqueness.js', () => ({
  assertProjectPathAvailable: vi.fn(async (inputPath: string) => inputPath),
  findProjectBySquadPath: vi.fn(async () => null),
}));

vi.mock('drizzle-orm', () => ({
  eq: (left: unknown, right: unknown) => ({ left, right }),
}));

await import('../routes/squad.js');

const createHandler = handlers['POST']?.['/create'];
if (!createHandler) throw new Error('POST /create handler not found');

const parentPath = fileURLToPath(
  new URL('../../.squad/test-runs/squad-create-structure-parent/', import.meta.url),
);

function makeReqRes(body: Record<string, unknown>) {
  const req = { body };
  let statusCode = 200;
  let jsonBody: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(bodyValue: unknown) {
      jsonBody = bodyValue;
      return res;
    },
  };

  return { req, res, getStatus: () => statusCode, getBody: () => jsonBody };
}

async function exists(targetPath: string): Promise<boolean> {
  return fs.access(targetPath).then(() => true, () => false);
}

describe('POST /api/squad/create folder structure', () => {
  beforeEach(async () => {
    insertedProjects.length = 0;
    linkProjectToSquadMock.mockReset();
    await fs.rm(parentPath, { recursive: true, force: true });
    await fs.mkdir(parentPath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(parentPath, { recursive: true, force: true });
  });

  it('scaffolds all Squad state under .squad without root-level state siblings', async () => {
    const projectName = 'created-from-squadboard';
    const projectPath = path.join(parentPath, projectName);
    const squadPath = path.join(projectPath, '.squad');
    const { req, res, getStatus, getBody } = makeReqRes({ parentPath, projectName });

    await createHandler(req, res);

    expect(getStatus()).toBe(201);
    expect(getBody()).toMatchObject({
      ok: true,
      data: {
        projectName,
        projectPath,
        squadPath,
      },
    });
    expect(linkProjectToSquadMock).toHaveBeenCalledWith('project-1', squadPath);

    expect((await fs.stat(squadPath)).isDirectory()).toBe(true);

    const expectedInsideSquad = [
      'agents',
      'casting',
      'decisions',
      'log',
      'orchestration-log',
      'skills',
      'team.md',
      'routing.md',
      'decisions.md',
      'ceremonies.md',
    ];
    for (const entry of expectedInsideSquad) {
      expect(await exists(path.join(squadPath, entry))).toBe(true);
    }

    const forbiddenRootSiblings = expectedInsideSquad;
    for (const entry of forbiddenRootSiblings) {
      expect(await exists(path.join(projectPath, entry))).toBe(false);
    }
  });
});

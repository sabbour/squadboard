/**
 * patch-project-fields.test.ts — W27 regression tests for future-patch-project-fields.
 *
 * Covers the PATCH /api/projects/:id handler validating name + description:
 *   1. Rename only (name)
 *   2. Description only
 *   3. Both name and description
 *   4. name validation rejection (empty string)
 *   5. description max-length rejection (>4000 chars)
 *
 * Uses the route handler directly as a pure function (no HTTP server needed).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB layer so we never need a real Postgres connection.
// ---------------------------------------------------------------------------

let capturedUpdates: Record<string, unknown> = {};
let shouldFindProject = true;

vi.mock('../db/index.js', () => {
  const mockReturning = vi.fn(() => {
    if (!shouldFindProject) return Promise.resolve([]);
    return Promise.resolve([
      {
        id: 'test-project-id',
        name: capturedUpdates['name'] ?? 'Original Name',
        description: capturedUpdates['description'] ?? null,
        defaultModel: capturedUpdates['defaultModel'] ?? null,
        costModel: null,
      },
    ]);
  });
  const mockWhere = vi.fn(() => ({ returning: mockReturning }));
  const mockSet = vi.fn((updates: Record<string, unknown>) => {
    capturedUpdates = updates;
    return { where: mockWhere };
  });
  const mockUpdate = vi.fn(() => ({ set: mockSet }));
  const mockDb = { update: mockUpdate };

  return {
    getDb: vi.fn(() => mockDb),
    schema: {
      projects: {
        $inferInsert: {},
        id: 'id',
      },
    },
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}));

vi.mock('../services/project-path-uniqueness.js', () => ({
  assertProjectPathAvailable: vi.fn(async (inputPath: string) =>
    inputPath.endsWith('/.squad') ? inputPath : `${inputPath}/.squad`,
  ),
}));

// ---------------------------------------------------------------------------
// Minimal Express-like mock: builds req/res and captures the response.
// ---------------------------------------------------------------------------

function makeReqRes(params: Record<string, string>, body: Record<string, unknown>) {
  const req = { params, body };
  let statusCode = 200;
  let jsonBody: unknown;

  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: unknown) {
      jsonBody = data;
      return res;
    },
  };

  return { req, res, getStatus: () => statusCode, getBody: () => jsonBody };
}

// ---------------------------------------------------------------------------
// Import the router handler — we call the handler function directly
// by extracting it from the route definition using a mini-router capture.
// ---------------------------------------------------------------------------

// We build a tiny Express-compatible Router stub that captures handlers by method.
const handlers: Record<string, Record<string, Function>> = {};

vi.mock('express', async () => {
  const router = {
    get: vi.fn((path: string, ...fns: Function[]) => {
      handlers['GET'] ??= {};
      handlers['GET'][path] = fns[fns.length - 1]!;
    }),
    post: vi.fn((path: string, ...fns: Function[]) => {
      handlers['POST'] ??= {};
      handlers['POST'][path] = fns[fns.length - 1]!;
    }),
    patch: vi.fn((path: string, ...fns: Function[]) => {
      handlers['PATCH'] ??= {};
      handlers['PATCH'][path] = fns[fns.length - 1]!;
    }),
    delete: vi.fn((path: string, ...fns: Function[]) => {
      handlers['DELETE'] ??= {};
      handlers['DELETE'][path] = fns[fns.length - 1]!;
    }),
  };
  return { Router: () => router };
});

// Load the route module (side-effect: registers handlers via the mocked Router).
await import('../routes/projects.js');
const { assertProjectPathAvailable } = await import('../services/project-path-uniqueness.js');
const mockAssertProjectPathAvailable = vi.mocked(assertProjectPathAvailable);

const patchHandler = handlers['PATCH']?.['/:id'];
if (!patchHandler) throw new Error('PATCH /:id handler not found — check route registration');

// ---------------------------------------------------------------------------

beforeEach(() => {
  capturedUpdates = {};
  shouldFindProject = true;
  mockAssertProjectPathAvailable.mockImplementation(async (inputPath: string) =>
    inputPath.endsWith('/.squad') ? inputPath : `${inputPath}/.squad`,
  );
});

// ---------------------------------------------------------------------------
// 1. Rename only
// ---------------------------------------------------------------------------

describe('PATCH /api/projects/:id — name + description (W27)', () => {
  it('rename only: updates name when only name is provided', async () => {
    const { req, res, getStatus, getBody } = makeReqRes(
      { id: 'test-project-id' },
      { name: 'Renamed Project' },
    );
    await patchHandler(req, res);
    expect(getStatus()).toBe(200);
    expect(capturedUpdates['name']).toBe('Renamed Project');
    expect(capturedUpdates).not.toHaveProperty('description');
  });

  // 2. Description only
  it('description only: updates description when only description is provided', async () => {
    const { req, res, getStatus } = makeReqRes(
      { id: 'test-project-id' },
      { description: 'A helpful project description.' },
    );
    await patchHandler(req, res);
    expect(getStatus()).toBe(200);
    expect(capturedUpdates['description']).toBe('A helpful project description.');
    expect(capturedUpdates).not.toHaveProperty('name');
  });

  // 3. Both name and description
  it('both: updates name and description together', async () => {
    const { req, res, getStatus } = makeReqRes(
      { id: 'test-project-id' },
      { name: 'My Project', description: 'Short blurb.' },
    );
    await patchHandler(req, res);
    expect(getStatus()).toBe(200);
    expect(capturedUpdates['name']).toBe('My Project');
    expect(capturedUpdates['description']).toBe('Short blurb.');
  });

  // 4. name validation rejection — empty string
  it('rejects empty name string with 400', async () => {
    const { req, res, getStatus, getBody } = makeReqRes(
      { id: 'test-project-id' },
      { name: '   ' },
    );
    await patchHandler(req, res);
    expect(getStatus()).toBe(400);
    expect((getBody() as Record<string, string>).error).toMatch(/non-empty/i);
  });

  // 5. description max-length rejection
  it('rejects description longer than 4000 chars with 400', async () => {
    const { req, res, getStatus, getBody } = makeReqRes(
      { id: 'test-project-id' },
      { description: 'x'.repeat(4001) },
    );
    await patchHandler(req, res);
    expect(getStatus()).toBe(400);
    expect((getBody() as Record<string, string>).error).toMatch(/4000/);
  });

  it('updates the registered project path after duplicate validation', async () => {
    const { req, res, getStatus } = makeReqRes(
      { id: 'test-project-id' },
      { path: '/tmp/renamed-project' },
    );
    await patchHandler(req, res);

    expect(getStatus()).toBe(200);
    expect(mockAssertProjectPathAvailable).toHaveBeenCalledWith('/tmp/renamed-project', {
      excludeProjectId: 'test-project-id',
    });
    expect(capturedUpdates['path']).toBe('/tmp/renamed-project/.squad');
  });

  it('returns a clear conflict when the requested path belongs to another project', async () => {
    mockAssertProjectPathAvailable.mockRejectedValueOnce(Object.assign(
      new Error('Folder path is already registered to project "Other".'),
      {
        status: 409,
        code: 'duplicate_project_path',
        projectId: 'other-project-id',
        projectName: 'Other',
        path: '/tmp/other/.squad',
      },
    ));
    const { req, res, getStatus, getBody } = makeReqRes(
      { id: 'test-project-id' },
      { path: '/tmp/other' },
    );
    await patchHandler(req, res);

    expect(getStatus()).toBe(409);
    expect(getBody()).toMatchObject({
      code: 'duplicate_project_path',
      projectId: 'other-project-id',
      projectName: 'Other',
      path: '/tmp/other/.squad',
    });
  });
});

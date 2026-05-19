import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFile = promisify(execFileCb);

const state = vi.hoisted(() => ({
  repoRoot: '',
  squadPath: '',
  issues: [] as Array<{ id: string; title: string; status: string; body?: string | null }>,
  inboxByKey: new Map<string, any>(),
  inboxCounter: 0,
}));

vi.mock('../db/index.js', () => {
  const query = () => ({
    limit: async () => [{ path: state.squadPath }],
    then: (
      resolve: (rows: typeof state.issues) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(state.issues).then(resolve, reject),
  });
  const selectChain = () => ({
    from: () => ({
      where: () => query(),
    }),
  });
  return {
    getDb: () => ({
      select: () => selectChain(),
    }),
    schema: {
      projects: {
        id: 'project_id',
        path: 'path',
      },
      issues: {
        id: 'issue_id',
        projectId: 'project_id',
        title: 'title',
        status: 'status',
        body: 'body',
      },
    },
  };
});

vi.mock('../services/inbox.js', () => ({
  createInboxItem: vi.fn(async (input: any) => {
    const key = input.idempotencyKey as string;
    const existing = state.inboxByKey.get(key);
    if (existing) return { item: existing, created: false };

    const item = {
      id: `inbox-${++state.inboxCounter}`,
      originalDraft: input.originalDraft,
      suggestedProjectId: input.suggestedProjectId,
      idempotencyKey: key,
      status: 'captured',
    };
    state.inboxByKey.set(key, item);
    return { item, created: true };
  }),
}));

import { invokeCeremony } from '../daemon/invoker.js';
import { invokeScribeCloseOut } from '../services/scribe-closeout.js';

const artifactRoot = path.resolve(process.cwd(), '.test-artifacts', 'scribe-closeout');
const fixedNow = new Date('2026-05-18T14:00:00.000Z');

async function resetArtifacts() {
  await fs.rm(artifactRoot, { recursive: true, force: true });
  state.repoRoot = path.join(artifactRoot, 'repo');
  state.squadPath = path.join(state.repoRoot, '.squad');
  state.issues = [
    { id: 'todo-1', title: 'Open item', status: 'in_progress' },
    { id: 'todo-2', title: 'Closed item', status: 'done' },
  ];
  state.inboxByKey.clear();
  state.inboxCounter = 0;

  await fs.mkdir(path.join(state.squadPath, 'decisions', 'inbox'), { recursive: true });
  await fs.mkdir(path.join(state.squadPath, 'agents'), { recursive: true });
  await execFile('git', ['-C', state.repoRoot, 'init']);
  await execFile('git', ['-C', state.repoRoot, 'config', 'user.email', 'scribe-closeout@example.test']);
  await execFile('git', ['-C', state.repoRoot, 'config', 'user.name', 'Scribe Closeout Test']);
  await fs.writeFile(path.join(state.squadPath, 'decisions.md'), '# Decisions\n\n', 'utf8');
}

async function seedDecisionInboxFile(name = 'closeout.md') {
  await fs.writeFile(
    path.join(state.squadPath, 'decisions', 'inbox', name),
    '## 2026-05-18T14:00:00.000Z: Closeout\n\nMerged by test.\n',
    'utf8',
  );
}

describe('Scribe close-out convergence', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetArtifacts();
  });

  afterEach(async () => {
    await fs.rm(artifactRoot, { recursive: true, force: true });
  });

  it('invokes the SDK closeOut path, writes health, and stores auditable metadata', async () => {
    await seedDecisionInboxFile();

    const result = await invokeScribeCloseOut({
      projectId: 'proj-1',
      source: 'server',
      now: fixedNow,
      captureCloseout: false,
      callMcp: false,
    });

    expect(result.ceremonyId).toBe('scribe-close-out');
    expect(result.source).toBe('server');
    expect(result.teamRoot).toBe(state.repoRoot);
    expect(result.squadDir).toBe(state.squadPath);
    expect(result.sdkResult.inboxFilesMerged).toBe(1);
    expect(result.sdkResult.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.healthReportPath).toContain(path.join('.squad', 'health'));
    expect(result.metadataPath).toContain(path.join('.squad', 'reports', 'scribe-close-out-'));

    const decisions = await fs.readFile(path.join(state.squadPath, 'decisions.md'), 'utf8');
    expect(decisions).toContain('Closeout');
    await expect(fs.access(result.healthReportPath!)).resolves.toBeUndefined();
    await expect(fs.access(result.metadataPath!)).resolves.toBeUndefined();

    const metadata = JSON.parse(await fs.readFile(result.metadataPath!, 'utf8'));
    expect(metadata.sdkResult.inboxFilesMerged).toBe(1);
    expect(metadata.healthReportPath).toBe(result.healthReportPath);
    expect(metadata.metadataPath).toBeUndefined();

    const latest = JSON.parse(await fs.readFile(result.latestMetadataPath!, 'utf8'));
    expect(latest.sdkResult.healthReportPath).toBe(result.healthReportPath);

    const second = await invokeScribeCloseOut({
      projectId: 'proj-1',
      source: 'server',
      now: fixedNow,
      captureCloseout: false,
      callMcp: false,
    });
    expect(second.sdkResult.inboxFilesMerged).toBe(0);
    expect(second.metadataPath).toBe(result.metadataPath);
  });

  it('captures closeout directives through the parity-3 service and fails open for MCP errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await invokeScribeCloseOut({
      projectId: 'proj-1',
      source: 'server',
      now: fixedNow,
      mcpCapture: vi.fn(async () => {
        throw new Error('mcp unavailable');
      }),
    });

    expect(result.directiveCapture).toMatchObject({
      phase: 'closeout',
      mcp: { status: 'failed', error: 'mcp unavailable' },
      inbox: { created: true },
    });
    const capture = result.directiveCapture as Exclude<typeof result.directiveCapture, null | { status: 'failed'; error: string }>;
    await expect(fs.access(capture.markdown.filePath)).resolves.toBeUndefined();
    expect(capture.markdown.filePath).toContain(path.join('.squad', 'decisions', 'inbox'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('directive closeout capture failed open'));
    warn.mockRestore();
  });

  it('daemon invoker uses the same SDK-backed service result shape', async () => {
    await seedDecisionInboxFile('daemon-closeout.md');

    const result = await invokeCeremony({
      projectId: 'proj-1',
      source: 'daemon',
      captureCloseout: false,
      callMcp: false,
    });

    expect(result.error).toBeUndefined();
    expect(result.ceremonyId).toBe('scribe-close-out');
    expect(result.teamRoot).toBe(state.repoRoot);
    expect(result.result).toMatchObject({
      ceremonyId: 'scribe-close-out',
      source: 'daemon',
      projectId: 'proj-1',
      teamRoot: state.repoRoot,
      sdkResult: {
        inboxFilesMerged: 1,
      },
    });
  });
});

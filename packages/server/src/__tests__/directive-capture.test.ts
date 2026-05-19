import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  squadPath: '',
  inboxByKey: new Map<string, any>(),
  inboxCounter: 0,
}));

vi.mock('../db/index.js', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ path: state.squadPath }],
        }),
      }),
    }),
  }),
  schema: {
    projects: {
      id: 'project_id',
      path: 'path',
    },
  },
}));

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

import {
  captureDirective,
  deriveDirectiveCaptureIdentity,
} from '../services/directive-capture.js';

const artifactRoot = path.resolve(process.cwd(), '.test-artifacts', 'directive-capture');

async function resetArtifacts() {
  await fs.rm(artifactRoot, { recursive: true, force: true });
  state.squadPath = path.join(artifactRoot, 'repo', '.squad');
  await fs.mkdir(path.join(state.squadPath, 'decisions', 'inbox'), { recursive: true });
}

describe('directive capture parity', () => {
  beforeEach(async () => {
    state.inboxByKey.clear();
    state.inboxCounter = 0;
    vi.clearAllMocks();
    await resetArtifacts();
  });

  afterEach(async () => {
    await fs.rm(artifactRoot, { recursive: true, force: true });
  });

  it('writes deterministic copilot directive markdown with idempotency metadata', async () => {
    const result = await captureDirective({
      projectId: 'proj-1',
      directive: 'Always use apply_patch for code edits.',
      sourceType: 'copilot-cli',
      sourceId: 'session-abc',
      now: new Date('2026-05-18T12:00:00.000Z'),
      callMcp: false,
    });

    expect(path.basename(result.markdown.filePath)).toMatch(
      /^copilot-directive-intake-copilot-cli-session-abc-[0-9a-f]{12}\.md$/,
    );

    const content = await fs.readFile(result.markdown.filePath, 'utf8');
    expect(content).toContain('### 2026-05-18T12:00:00.000Z: User directive');
    expect(content).toContain('**By:** user (via Copilot)');
    expect(content).toContain('**What:** Always use apply_patch for code edits.');
    expect(content).toContain('**Phase:** intake');
    expect(content).toContain('**Source:** copilot-cli:session-abc');
    expect(content).toContain(`**Idempotency-Key:** ${result.idempotencyKey}`);
    expect(content).toContain(`**Directive-Hash:** sha256:${result.directiveHash}`);
    expect(result.audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: 'markdown', status: 'created' }),
        expect.objectContaining({ step: 'mcp_capture', status: 'skipped' }),
        expect.objectContaining({ step: 'db_capture', status: 'created' }),
      ]),
    );
  });

  it('dedupes repeated intake captures by source, directive hash, and phase', async () => {
    const input = {
      projectId: 'proj-1',
      directive: 'Fix hover resize on project tiles.',
      sourceType: 'copilot-cli',
      sourceId: 'turn-7',
      callMcp: false,
    };

    const first = await captureDirective(input);
    const second = await captureDirective(input);
    const files = await fs.readdir(path.join(state.squadPath, 'decisions', 'inbox'));

    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.markdown.filePath).toBe(first.markdown.filePath);
    expect(second.markdown.status).toBe('deduped');
    expect(second.inbox.created).toBe(false);
    expect(files.filter((f) => f.endsWith('.md'))).toHaveLength(1);
  });

  it('uses a different idempotency key for closeout done: captures', () => {
    const intake = deriveDirectiveCaptureIdentity({
      directive: 'Fix hover resize on project tiles.',
      sourceType: 'copilot-cli',
      sourceId: 'turn-7',
      phase: 'intake',
    });
    const closeout = deriveDirectiveCaptureIdentity({
      directive: 'Fix hover resize on project tiles.',
      sourceType: 'copilot-cli',
      sourceId: 'turn-7',
      phase: 'closeout',
    });
    const inferredCloseout = deriveDirectiveCaptureIdentity({
      directive: 'done: Fix hover resize on project tiles (sha=abc123)',
      sourceType: 'copilot-cli',
      sourceId: 'turn-7',
    });

    expect(closeout.idempotencyKey).not.toBe(intake.idempotencyKey);
    expect(inferredCloseout.phase).toBe('closeout');
  });

  it('fails open when MCP capture throws and keeps markdown plus DB capture', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mcpCapture = vi.fn(async () => {
      throw new Error('mcp offline');
    });

    const result = await captureDirective({
      projectId: 'proj-1',
      directive: 'Fix the login bug.',
      sourceType: 'copilot-cli',
      sourceId: 'turn-9',
      mcpCapture,
    });

    await expect(fs.access(result.markdown.filePath)).resolves.toBeUndefined();
    expect(result.inbox.itemId).toBe('inbox-1');
    expect(result.inbox.created).toBe(true);
    expect(result.mcp).toMatchObject({ status: 'failed', error: 'mcp offline' });
    expect(result.audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: 'mcp_capture', status: 'failed', error: 'mcp offline' }),
        expect.objectContaining({ step: 'db_capture', status: 'created' }),
      ]),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MCP capture failed open'));
    warn.mockRestore();
  });

  it('passes closeout done: prompts through MCP with the closeout idempotency key', async () => {
    const mcpCapture = vi.fn(async () => ({ action: 'issue_closed' }));

    const result = await captureDirective({
      projectId: 'proj-1',
      directive: 'done: Fix hover resize on project tiles (sha=abc123)',
      sourceType: 'copilot-cli',
      sourceId: 'turn-7',
      mcpCapture,
    });

    expect(result.phase).toBe('closeout');
    expect(mcpCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'done: Fix hover resize on project tiles (sha=abc123)',
        phase: 'closeout',
        idempotencyKey: result.idempotencyKey,
      }),
    );
    expect(result.mcp.status).toBe('succeeded');
  });
});

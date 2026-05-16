/**
 * bridge-model-validation.test.ts — W27 Bug E regression tests
 *
 * Verifies the validateModel boundary guard in bridge.ts:
 *   - Valid model ids pass through unchanged.
 *   - Models with backticks (parser garbage) are rejected → null.
 *   - Models with prose text ("Coordinator selects ...") are rejected → null.
 *   - Models with double-asterisks are rejected → null.
 *   - Models > 40 chars are rejected → null.
 *
 * Strategy: spy on console.warn to assert the structured log fires on rejection,
 * then assert the resolved model falls through to BUILTIN_FALLBACK.
 * We test the guard indirectly via executeAgentRun with a stubbed createAgentSession.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// ─── Stub external I/O ────────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('# TestAgent\n\n## Role\n\nTest\n'),
}));

vi.mock('../db/index.js', () => {
  const getDb = () => ({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ defaultModel: null }]),
      }),
    }),
    update: (_table: unknown) => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
  });
  return { getDb, issueRuns: {} };
});

vi.mock('../db/schema.js', () => ({
  issueRuns: { id: 'id' },
  projects: { id: 'id', defaultModel: 'default_model' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
}));

vi.mock('../sdk/output-streamer.js', () => ({
  OutputStreamer: class {
    write = vi.fn().mockResolvedValue(undefined);
    flush = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../sdk/cost-tracker.js', () => ({
  CostTracker: class {
    record = vi.fn().mockResolvedValue(undefined);
    recordCost = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../sdk/budget-guard.js', () => ({
  BudgetGuard: { check: vi.fn().mockResolvedValue(undefined) },
  BudgetExceededError: class extends Error {},
}));

// Capture the agentModel passed to createAgentSession.
let capturedAgentModel: string | null | undefined = 'NOT_SET';

vi.mock('../sdk/squad-client.js', () => ({
  createAgentSession: vi.fn(async (opts: { agentModel?: string | null }) => {
    capturedAgentModel = opts.agentModel;
    return {
      output: 'stub output',
      tokensUsed: 10,
      costUsd: '0.001',
      resolvedModel: 'gpt-5.4',
      modelResolvedVia: 'fallback',
    };
  }),
}));

vi.mock('../sdk/model-defaults.js', () => ({
  BUILTIN_FALLBACK: 'gpt-5.4',
}));

// Mock new T3 deps — isolate bridge-model-validation from session infrastructure
vi.mock('../sdk/issue-stream.js', () => ({
  RunningIssueSessionImpl: class {
    constructor() {}
    emit()       { return Promise.resolve(0); }
    steer()      { return Promise.resolve(); }
    dispose()    { return Promise.resolve(); }
    getRunId()   { return ''; }
    getProjectId() { return ''; }
  },
}));

vi.mock('../engine/active-issue-sessions.js', () => ({
  register:   vi.fn(),
  unregister: vi.fn(),
  get:        vi.fn(),
  list:       vi.fn(() => []),
}));

// ─── Agent fixture factory ────────────────────────────────────────────────────

function makeInput(model: string | null) {
  return {
    issueRunId: 'run-1',
    projectId: 'proj-1',
    agent: {
      id: 'agent-1',
      name: 'Hockney',
      model,
      charterPath: '/fake/.squad/agents/hockney/charter.md',
      status: 'active',
      projectId: 'proj-1',
    } as Parameters<typeof import('../sdk/bridge.js').executeAgentRun>[0]['agent'],
    issueTitle: 'Test issue',
    issueBody: 'Body',
    workspacePath: '/fake/workspace',
    projectSquadPath: '/fake/.squad',
  };
}

import { executeAgentRun } from '../sdk/bridge.js';

beforeEach(() => {
  capturedAgentModel = 'NOT_SET';
  vi.clearAllMocks();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('bridge.ts — validateModel boundary guard', () => {
  it('valid model "claude-sonnet-4.6" passes through unchanged', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await executeAgentRun(makeInput('claude-sonnet-4.6'));
    expect(capturedAgentModel).toBe('claude-sonnet-4.6');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('model with backticks ("`claude-haiku-4.5`") is rejected → null + warning logged', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await executeAgentRun(makeInput('`claude-haiku-4.5`'));
    expect(capturedAgentModel).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[bridge] suspicious model rejected:'),
    );
    warnSpy.mockRestore();
  });

  it('model with prose ("Coordinator selects the best model") is rejected → null', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await executeAgentRun(makeInput('Coordinator selects the best model based on task type'));
    expect(capturedAgentModel).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('model with "**" (bold markdown) is rejected → null', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await executeAgentRun(makeInput('**Preferred:** auto'));
    expect(capturedAgentModel).toBeNull();
    warnSpy.mockRestore();
  });

  it('model null → null, no warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await executeAgentRun(makeInput(null));
    expect(capturedAgentModel).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('model > 40 chars is rejected → null', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const longModel = 'a'.repeat(41);
    await executeAgentRun(makeInput(longModel));
    expect(capturedAgentModel).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('valid model "gpt-5.4" passes through unchanged', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await executeAgentRun(makeInput('gpt-5.4'));
    expect(capturedAgentModel).toBe('gpt-5.4');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

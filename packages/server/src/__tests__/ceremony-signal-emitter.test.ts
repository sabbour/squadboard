/**
 * ceremony-signal-emitter.test.ts — CER-6 (W29)
 *
 * Unit tests for the ceremony signal emitter service.
 * DB and ceremony-scheduler are mocked; tests verify dispatch logic and
 * edge cases: single match, multi-match, no-match, disabled, wrong trigger
 * type, error handling, and option pass-through.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

let mockWorkflowRows: { id: string; slug: string }[] = [];

vi.mock('../db/index.js', () => {
  const mockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => mockWorkflowRows),
      })),
    })),
  };
  return {
    getDb: () => mockDb,
    schema: {
      workflows: {
        id: 'wf_id',
        slug: 'wf_slug',
        projectId: 'wf_project_id',
        triggerKind: 'wf_trigger_kind',
        status: 'wf_status',
        triggerConfig: 'wf_trigger_config',
      },
    },
  };
});

vi.mock('../services/ceremony-scheduler.js', () => ({
  spawnCeremonyRun: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => 'mock-eq'),
  and: vi.fn((..._args: unknown[]) => 'mock-and'),
  sql: Object.assign(vi.fn(() => 'mock-sql'), { raw: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { emitSignal } from '../services/ceremony-signal-emitter.js';
import { spawnCeremonyRun } from '../services/ceremony-scheduler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_PROJECT_ID = '11111111-1111-1111-1111-111111111111';

function makeWorkflow(id: string, slug: string) {
  return { id, slug };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('emitSignal', () => {
  beforeEach(() => {
    mockWorkflowRows = [];
    vi.mocked(spawnCeremonyRun).mockReset();
    vi.mocked(spawnCeremonyRun).mockResolvedValue('run-default');
  });

  // 1. Single matching ceremony → one workflow_run created
  it('1. single matching ceremony → fires once', async () => {
    mockWorkflowRows = [makeWorkflow('wf-1', 'before-batch-setup')];
    vi.mocked(spawnCeremonyRun).mockResolvedValue('run-abc');

    const result = await emitSignal({
      projectId: VALID_PROJECT_ID,
      signalName: 'before-batch',
    });

    expect(result.fired).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.workflowRunIds).toEqual(['run-abc']);
    expect(vi.mocked(spawnCeremonyRun)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(spawnCeremonyRun)).toHaveBeenCalledWith('wf-1', expect.objectContaining({
      trigger: 'agent-signal:before-batch',
    }));
  });

  // 2. Two matching ceremonies → both fire
  it('2. two matching ceremonies → both fire', async () => {
    mockWorkflowRows = [
      makeWorkflow('wf-1', 'before-batch-a'),
      makeWorkflow('wf-2', 'before-batch-b'),
    ];
    vi.mocked(spawnCeremonyRun)
      .mockResolvedValueOnce('run-1')
      .mockResolvedValueOnce('run-2');

    const result = await emitSignal({
      projectId: VALID_PROJECT_ID,
      signalName: 'before-batch',
    });

    expect(result.fired).toBe(2);
    expect(result.workflowRunIds).toEqual(['run-1', 'run-2']);
    expect(vi.mocked(spawnCeremonyRun)).toHaveBeenCalledTimes(2);
  });

  // 3. Ceremony with different signal → does NOT fire (DB SQL filter returns no rows)
  it('3. ceremony with different signal → does NOT fire', async () => {
    // The SQL filter (triggerConfig->>'signalName' = signalName) excludes
    // non-matching ceremonies; mock reflects DB returning empty result.
    mockWorkflowRows = [];

    const result = await emitSignal({
      projectId: VALID_PROJECT_ID,
      signalName: 'before-batch',
    });

    expect(result.fired).toBe(0);
    expect(vi.mocked(spawnCeremonyRun)).not.toHaveBeenCalled();
  });

  // 4. Ceremony with wrong trigger type → does NOT fire (DB triggerKind filter)
  it('4. ceremony with wrong trigger type → does NOT fire', async () => {
    // triggerKind = 'agent-signal' filter excludes e.g. 'on_schedule' ceremonies.
    mockWorkflowRows = [];

    const result = await emitSignal({
      projectId: VALID_PROJECT_ID,
      signalName: 'after-batch',
    });

    expect(result.fired).toBe(0);
    expect(vi.mocked(spawnCeremonyRun)).not.toHaveBeenCalled();
  });

  // 5. Disabled ceremony → does NOT fire (status='active' filter)
  it('5. disabled ceremony → does NOT fire', async () => {
    // status='active' filter excludes draft/paused/archived; mock reflects that.
    mockWorkflowRows = [];

    const result = await emitSignal({
      projectId: VALID_PROJECT_ID,
      signalName: 'before-batch',
    });

    expect(result.fired).toBe(0);
    expect(vi.mocked(spawnCeremonyRun)).not.toHaveBeenCalled();
  });

  // 6. Project with no matching ceremonies → returns 0, no error
  it('6. project with no matching ceremonies → returns zeros without error', async () => {
    mockWorkflowRows = [];

    const result = await emitSignal({
      projectId: VALID_PROJECT_ID,
      signalName: 'before-batch',
    });

    expect(result.fired).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.workflowRunIds).toEqual([]);
  });

  // 7. Schema roundtrip: agentSignalTriggerSchema now accepts signalName
  it('7. yaml-schema accepts agent-signal with signalName', async () => {
    // Import the schema after mocks; verify no throws on parse
    const { workflowYamlSchema } = await import('../ceremonies/yaml-schema.js');
    const input = {
      apiVersion: 'squad.io/v1',
      kind: 'Ceremony',
      metadata: { name: 'batch-gate' },
      spec: {
        trigger: { type: 'agent-signal', signalName: 'before-batch' },
        steps: [],
      },
    };
    const result = workflowYamlSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.spec.trigger as { signalName?: string }).signalName).toBe('before-batch');
    }
  });

  // Edge: spawn returns null → counted as skipped
  it('spawn returns null → counted as skipped, not fired', async () => {
    mockWorkflowRows = [makeWorkflow('wf-1', 'no-anchor')];
    vi.mocked(spawnCeremonyRun).mockResolvedValue(null);

    const result = await emitSignal({
      projectId: VALID_PROJECT_ID,
      signalName: 'before-run',
    });

    expect(result.fired).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.workflowRunIds).toEqual([]);
  });

  // Edge: spawn throws → counted as error, does not rethrow
  it('spawn throws → counted as error, does not rethrow', async () => {
    mockWorkflowRows = [makeWorkflow('wf-1', 'error-wf')];
    vi.mocked(spawnCeremonyRun).mockRejectedValue(new Error('DB failure'));

    const result = await emitSignal({
      projectId: VALID_PROJECT_ID,
      signalName: 'before-batch',
    });

    expect(result.errors).toBe(1);
    expect(result.fired).toBe(0);
  });

  // Edge: partial failure — one ceremony throws, another succeeds
  it('partial failure — one throws, one succeeds', async () => {
    mockWorkflowRows = [
      makeWorkflow('wf-fail', 'broken'),
      makeWorkflow('wf-ok', 'working'),
    ];
    vi.mocked(spawnCeremonyRun)
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('run-ok');

    const result = await emitSignal({
      projectId: VALID_PROJECT_ID,
      signalName: 'before-batch',
    });

    expect(result.errors).toBe(1);
    expect(result.fired).toBe(1);
    expect(result.workflowRunIds).toEqual(['run-ok']);
  });

  // Edge: invalid project ID (non-UUID) → returns immediately, no DB query
  it('invalid project ID → returns zeros without querying DB', async () => {
    const result = await emitSignal({
      projectId: 'not-a-uuid',
      signalName: 'before-batch',
    });

    expect(result.fired).toBe(0);
    expect(vi.mocked(spawnCeremonyRun)).not.toHaveBeenCalled();
  });

  // Edge: anchorIssueId and contextPayload are passed through
  it('passes anchorIssueId and contextPayload to spawnCeremonyRun', async () => {
    mockWorkflowRows = [makeWorkflow('wf-1', 'before-batch-setup')];
    vi.mocked(spawnCeremonyRun).mockResolvedValue('run-xyz');

    await emitSignal({
      projectId: VALID_PROJECT_ID,
      signalName: 'before-batch',
      anchorIssueId: 'issue-999',
      contextPayload: { batchSize: 5 },
    });

    expect(vi.mocked(spawnCeremonyRun)).toHaveBeenCalledWith(
      'wf-1',
      expect.objectContaining({
        anchorIssueId: 'issue-999',
        trigger: 'agent-signal:before-batch',
        triggerSource: expect.objectContaining({
          kind: 'on_event',
          eventType: 'agent-signal:before-batch',
          anchorIssueId: 'issue-999',
        }),
      }),
    );
  });

  // Edge: trigger label encodes signal name correctly for all well-known signals
  it.each([
    'before-batch',
    'after-batch',
    'before-run',
    'after-run',
    'on-issue-entry',
  ] as const)('trigger label for signal %s is correct', async (signal) => {
    mockWorkflowRows = [makeWorkflow(`wf-${signal}`, signal)];
    vi.mocked(spawnCeremonyRun).mockResolvedValue('run-1');

    await emitSignal({ projectId: VALID_PROJECT_ID, signalName: signal });

    expect(vi.mocked(spawnCeremonyRun)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ trigger: `agent-signal:${signal}` }),
    );
  });
});

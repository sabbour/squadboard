/**
 * ceremony-runs-route.test.ts — ceremony execution history regression.
 *
 * Verifies GET /api/projects/:projectId/ceremonies/:id/runs returns the
 * workflow run, step run, and issue-run event log data needed by the UI.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

let selectQueue: unknown[][] = [];

function pushSelect(rows: unknown[]): void {
  selectQueue.push(rows);
}

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.leftJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (onfulfilled: (value: unknown[]) => unknown) => Promise.resolve(rows).then(onfulfilled);
  return chain;
}

vi.mock('../db/index.js', () => {
  const schema = {
    workflows: {
      id: 'workflows.id',
      projectId: 'workflows.project_id',
      name: 'workflows.name',
      slug: 'workflows.slug',
      triggerKind: 'workflows.trigger_kind',
      triggerConfig: 'workflows.trigger_config',
      kind: 'workflows.kind',
      status: 'workflows.status',
      parentNarrativeId: 'workflows.parent_narrative_id',
      description: 'workflows.description',
      createdAt: 'workflows.created_at',
      updatedAt: 'workflows.updated_at',
    },
    workflowVersions: {
      id: 'workflow_versions.id',
      workflowId: 'workflow_versions.workflow_id',
      version: 'workflow_versions.version',
      yamlContent: 'workflow_versions.yaml_content',
      jsonSchema: 'workflow_versions.json_schema',
      isActive: 'workflow_versions.is_active',
      createdAt: 'workflow_versions.created_at',
    },
    workflowRuns: {
      id: 'workflow_runs.id',
      issueId: 'workflow_runs.issue_id',
      workflowVersionId: 'workflow_runs.workflow_version_id',
      status: 'workflow_runs.status',
      currentStepIndex: 'workflow_runs.current_step_index',
      triggerSource: 'workflow_runs.trigger_source',
      premiumRequests: 'workflow_runs.premium_requests',
      createdAt: 'workflow_runs.created_at',
      updatedAt: 'workflow_runs.updated_at',
    },
    stepRuns: {
      id: 'step_runs.id',
      workflowRunId: 'step_runs.workflow_run_id',
      issueRunId: 'step_runs.issue_run_id',
      stepIndex: 'step_runs.step_index',
      stepType: 'step_runs.step_type',
      status: 'step_runs.status',
      output: 'step_runs.output',
      reviewDecision: 'step_runs.review_decision',
      reviewComment: 'step_runs.review_comment',
      sessionId: 'step_runs.session_id',
      startedAt: 'step_runs.started_at',
      createdAt: 'step_runs.created_at',
      updatedAt: 'step_runs.updated_at',
    },
    issueRuns: {
      id: 'issue_runs.id',
      issueId: 'issue_runs.issue_id',
      agentId: 'issue_runs.agent_id',
      status: 'issue_runs.status',
      output: 'issue_runs.output',
      errorMessage: 'issue_runs.error_message',
    },
    issueRunEvents: {
      id: 'issue_run_events.id',
      runId: 'issue_run_events.run_id',
      seq: 'issue_run_events.seq',
      eventType: 'issue_run_events.event_type',
      payload: 'issue_run_events.payload',
      createdAt: 'issue_run_events.created_at',
    },
    issues: {
      id: 'issues.id',
      title: 'issues.title',
      status: 'issues.status',
    },
    agents: {
      id: 'agents.id',
      name: 'agents.name',
      projectId: 'agents.project_id',
      role: 'agents.role',
    },
    projects: { id: 'projects.id', githubOwner: 'projects.github_owner', githubRepo: 'projects.github_repo' },
    ceremonySchedules: {
      id: 'ceremony_schedules.id',
      workflowId: 'ceremony_schedules.workflow_id',
      enabled: 'ceremony_schedules.enabled',
      cronExpr: 'ceremony_schedules.cron_expr',
      timezone: 'ceremony_schedules.timezone',
      nextFireAt: 'ceremony_schedules.next_fire_at',
      lastFiredAt: 'ceremony_schedules.last_fired_at',
      createdAt: 'ceremony_schedules.created_at',
      updatedAt: 'ceremony_schedules.updated_at',
    },
  };
  return {
    getDb: () => ({
      select: vi.fn(() => makeChain(selectQueue.shift() ?? [])),
      insert: vi.fn(() => makeChain([])),
      update: vi.fn(() => makeChain([])),
      delete: vi.fn(() => makeChain([])),
    }),
    schema,
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args) => ({ and: args })),
  inArray: vi.fn((a, b) => ({ inArray: [a, b] })),
  desc: vi.fn((a) => ({ desc: a })),
  asc: vi.fn((a) => ({ asc: a })),
  gte: vi.fn((a, b) => ({ gte: [a, b] })),
  count: vi.fn(() => ({ count: true })),
  isNotNull: vi.fn((a) => ({ isNotNull: a })),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

vi.mock('../services/workflow-parser.js', () => ({
  parseWorkflowYaml: vi.fn(),
  validateWorkflowYaml: vi.fn(() => ({ valid: true, errors: [] })),
}));
vi.mock('../services/ceremony-origin.js', () => ({ deriveOrigin: vi.fn(() => 'user-created') }));
vi.mock('../services/ceremony-scheduler.js', () => ({
  spawnCeremonyRun: vi.fn(),
  previewNextFireTimes: vi.fn(),
  computeNextFire: vi.fn(),
}));
vi.mock('../services/ceremony-translator.js', () => ({
  translateNarrative: vi.fn(),
  translateProse: vi.fn(),
  refineProse: vi.fn(),
  invokeBuiltInCeremony: vi.fn(),
  TranslatorError: class TranslatorError extends Error {},
  TranslatorThrottledError: class TranslatorThrottledError extends Error {},
}));
vi.mock('../workflows/templates/index.js', () => ({ getBuiltinTemplates: vi.fn(() => []) }));
vi.mock('../services/ceremony-yaml-export.js', () => ({ exportCeremonyAsYaml: vi.fn() }));
vi.mock('../services/ceremony-yaml-import.js', () => ({ importCeremonyFromYaml: vi.fn() }));
vi.mock('../ceremonies/built-in/protection.js', () => ({ isProtectedBuiltInCeremony: vi.fn(() => false) }));
vi.mock('../services/worktree-lifecycle.js', () => ({
  buildRunLifecycleMetadata: vi.fn(() => ({ model: 'squadboard.lifecycle.v1' })),
  resolveWorktreeExists: vi.fn(),
}));

const handlers: Record<string, Record<string, Function>> = {};

vi.mock('express', () => ({
  Router: vi.fn(() => ({
    get: vi.fn((path: string, ...fns: Function[]) => {
      handlers.GET ??= {};
      handlers.GET[path] = fns[fns.length - 1]!;
    }),
    post: vi.fn((path: string, ...fns: Function[]) => {
      handlers.POST ??= {};
      handlers.POST[path] = fns[fns.length - 1]!;
    }),
    patch: vi.fn((path: string, ...fns: Function[]) => {
      handlers.PATCH ??= {};
      handlers.PATCH[path] = fns[fns.length - 1]!;
    }),
    delete: vi.fn((path: string, ...fns: Function[]) => {
      handlers.DELETE ??= {};
      handlers.DELETE[path] = fns[fns.length - 1]!;
    }),
  })),
}));

await import('../routes/ceremonies.js');

function makeReqRes() {
  const req = {
    params: { projectId: 'project-123', id: 'ceremony-123' },
    query: {},
    body: {},
  };
  let statusCode = 200;
  let jsonBody: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: unknown) {
      jsonBody = body;
      return res;
    },
    getStatus: () => statusCode,
    getJson: () => jsonBody,
  };
  return { req, res };
}

describe('GET /:id/runs', () => {
  beforeEach(() => {
    selectQueue = [];
  });

  it('returns ceremony runs with step logs and recent issue-run events', async () => {
    pushSelect([{
      id: 'ceremony-123',
      projectId: 'project-123',
      name: 'Daily Close-Out',
      slug: 'daily-close-out',
      triggerKind: 'manual',
      kind: 'ceremony',
    }]);
    pushSelect([{ id: 'version-1', version: 1, createdAt: new Date('2026-05-20T10:00:00Z') }]);
    pushSelect([{
      id: 'workflow-run-1',
      issueId: 'issue-1',
      issueTitle: 'Close out work',
      issueStatus: 'ready',
      workflowVersionId: 'version-1',
      workflowVersionNumber: 1,
      status: 'running',
      currentStepIndex: 0,
      triggerSource: { kind: 'manual' },
      premiumRequests: '0',
      createdAt: new Date('2026-05-20T11:00:00Z'),
      updatedAt: new Date('2026-05-20T11:01:00Z'),
    }]);
    pushSelect([{
      id: 'step-1',
      workflowRunId: 'workflow-run-1',
      issueRunId: 'issue-run-1',
      stepIndex: 0,
      stepType: 'agent_run',
      status: 'running',
      output: 'step output',
      reviewDecision: null,
      reviewComment: null,
      sessionId: 'session-1',
      startedAt: new Date('2026-05-20T11:00:10Z'),
      createdAt: new Date('2026-05-20T11:00:00Z'),
      updatedAt: new Date('2026-05-20T11:01:00Z'),
      issueRunStatus: 'running',
      issueRunOutput: 'agent output',
      issueRunError: null,
      agentId: 'agent-1',
      agentName: 'Scribe',
    }]);
    pushSelect([{
      id: 1,
      runId: 'issue-run-1',
      seq: 0,
      eventType: 'issue.run.start',
      payload: { agentName: 'Scribe' },
      createdAt: new Date('2026-05-20T11:00:20Z'),
    }]);

    const handler = handlers.GET?.['/:id/runs'];
    expect(handler).toBeDefined();
    const { req, res } = makeReqRes();

    await handler!(req as unknown as Request, res as unknown as Response);

    expect(res.getStatus()).toBe(200);
    const body = res.getJson() as {
      ceremony: { name: string };
      runs: Array<{ id: string; steps: Array<{ issueRunId: string; events: Array<{ eventType: string }> }> }>;
    };
    expect(body.ceremony.name).toBe('Daily Close-Out');
    expect(body.runs[0]?.id).toBe('workflow-run-1');
    expect(body.runs[0]?.steps[0]?.issueRunId).toBe('issue-run-1');
    expect(body.runs[0]?.steps[0]?.events[0]?.eventType).toBe('issue.run.start');
  });

  it('returns 404 when the ceremony is not in the project', async () => {
    pushSelect([]);

    const handler = handlers.GET?.['/:id/runs'];
    const { req, res } = makeReqRes();

    await handler!(req as unknown as Request, res as unknown as Response);

    expect(res.getStatus()).toBe(404);
    expect((res.getJson() as { error: string }).error).toMatch(/ceremony not found/i);
  });
});

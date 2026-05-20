import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
}));

let selectRows: unknown[][] = [];

function makeSelectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    then: (onfulfilled: (value: unknown[]) => unknown) => Promise.resolve(rows).then(onfulfilled),
  };
}

vi.mock('../db/index.js', () => ({
  getDb: () => dbMock,
  schema: {
    routingLog: {
      id: 'routing_log.id',
      projectId: 'routing_log.project_id',
      issueId: 'routing_log.issue_id',
      tier: 'routing_log.tier',
      resolvedAgent: 'routing_log.resolved_agent',
      matchedRule: 'routing_log.matched_rule',
      score: 'routing_log.score',
      reasoning: 'routing_log.reasoning',
      specifierRunId: 'routing_log.specifier_run_id',
      decidedAt: 'routing_log.decided_at',
    },
    issues: {
      id: 'issues.id',
      projectId: 'issues.project_id',
      title: 'issues.title',
    },
    issueRuns: {
      id: 'issue_runs.id',
      issueId: 'issue_runs.issue_id',
      agentId: 'issue_runs.agent_id',
      routingTier: 'issue_runs.routing_tier',
      routingScore: 'issue_runs.routing_score',
      routingReasoning: 'issue_runs.routing_reasoning',
      createdAt: 'issue_runs.created_at',
    },
    agents: {
      id: 'agents.id',
      name: 'agents.name',
    },
    routingRules: {
      projectId: 'routing_rules.project_id',
      priority: 'routing_rules.priority',
    },
  },
}));

vi.mock('../engine/router.js', () => ({
  loadRoutingRules: vi.fn(),
  refreshAgentKeywords: vi.fn(),
  resolveRouteFull: vi.fn(),
}));

import routingRouter from '../routes/routing.js';

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response, next: NextFunction) => void }>;
  };
};

function findHandler(path: string, method: 'get' | 'post') {
  const stack = (routingRouter as unknown as { stack: RouteLayer[] }).stack;
  for (const layer of stack) {
    if (layer.route?.path === path && layer.route.methods[method]) {
      return layer.route.stack[0]?.handle;
    }
  }
  return null;
}

function makeReq() {
  return {
    params: { projectId: 'project-1' },
    query: {},
    body: {},
  };
}

function makeRes() {
  return {
    _status: 200,
    _body: null as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
  };
}

describe('routing log route', () => {
  beforeEach(() => {
    dbMock.select.mockReset();
    selectRows = [];
    dbMock.select.mockImplementation(() => makeSelectChain(selectRows.shift() ?? []));
  });

  it('maps stored decisions to the client shape and backfills run-only decisions', async () => {
    selectRows = [
      [{
        id: 'log-1',
        issueId: 'issue-1',
        issueTitle: 'Clarify Routing',
        tier: 2,
        resolvedAgent: 'mcmanus',
        matchedRule: 'keyword-score',
        score: '0.4200',
        reasoning: 'tier2 score=0.4200 keywords: [routing]',
        specifierRunId: null,
        decidedAt: new Date('2026-05-20T04:06:00Z'),
      }],
      [{
        id: 'run-2',
        issueId: 'issue-2',
        issueTitle: 'Clarify Routing Again',
        tier: 3,
        resolvedAgent: 'kujan',
        score: null,
        reasoning: 'pickup-ready: least-loaded fallback',
        decidedAt: new Date('2026-05-20T04:05:00Z'),
      }],
    ];
    const handler = findHandler('/log', 'get');
    const res = makeRes();

    await handler!(makeReq() as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    expect(res._status).toBe(200);
    expect(res._body).toEqual([
      expect.objectContaining({
        id: 'log-1',
        issueTitle: 'Clarify Routing',
        tier: 'T2',
        matchedRule: 'keyword-score',
        agentName: 'mcmanus',
        score: 0.42,
      }),
      expect.objectContaining({
        id: 'run:run-2',
        issueTitle: 'Clarify Routing Again',
        tier: 'T3',
        matchedRule: 'pickup-ready:least-loaded-fallback',
        agentName: 'kujan',
      }),
    ]);
  });

  it('returns flat stats expected by the client and ignores preview-only rows', async () => {
    selectRows = [
      [
        { issueId: null, tier: 2, score: '0.0100' },
        { issueId: 'issue-1', tier: 2, score: '0.4200' },
      ],
      [
        { issueId: 'issue-1', tier: 2, score: '0.4200' },
        { issueId: 'issue-2', tier: 3, score: null },
      ],
    ];
    const handler = findHandler('/stats', 'get');
    const res = makeRes();

    await handler!(makeReq() as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    expect(res._body).toEqual({
      total: 2,
      tier1Count: 0,
      tier2Count: 1,
      tier2AvgScore: 0.42,
      tier3Count: 1,
      triageCount: 0,
    });
  });
});

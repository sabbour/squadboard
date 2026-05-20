/**
 * routing.ts — REST endpoints for routing management (Demo 5 + Demo 8)
 *
 * POST /api/projects/:projectId/routing/reload      — reload routing.md from disk
 * GET  /api/projects/:projectId/routing/rules       — list cached routing rules
 * POST /api/projects/:projectId/routing/test        — simulate full 3-tier routing (no issueRun created)
 * GET  /api/projects/:projectId/routing/log         — last 100 routing decisions
 * GET  /api/projects/:projectId/routing/stats       — tier 1/2/3 counts + avg score
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { and, eq, desc, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { loadRoutingRules, resolveRouteFull, refreshAgentKeywords } from '../engine/router.js';

const router = Router({ mergeParams: true });

function handleError(res: Response, err: unknown) {
  if (err instanceof Error && (err as NodeJS.ErrnoException & { status?: number }).status) {
    const s = (err as unknown as { status: number }).status;
    res.status(s).json({ error: err.message });
    return;
  }
  console.error('[routing] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

function tierLabel(tier: number | null): 'T1' | 'T2' | 'T3' | null {
  if (tier === 1) return 'T1';
  if (tier === 2) return 'T2';
  if (tier === 3) return 'T3';
  return null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function runMatchedRule(tier: number | null, reasoning: string | null): string {
  if (reasoning?.startsWith('pickup-ready: least-loaded')) return 'pickup-ready:least-loaded-fallback';
  if (tier === 1) return 'coordinator:dispatch';
  if (tier === 2) return 'keyword-score';
  if (tier === 3) return 'fallback';
  return 'run-routing';
}

// ---------------------------------------------------------------------------
// POST /reload — reload routing.md from disk
// ---------------------------------------------------------------------------

router.post('/reload', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;

    const [project] = await getDb()
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await loadRoutingRules(projectId, project.path);

    const rules = await getDb()
      .select()
      .from(schema.routingRules)
      .where(eq(schema.routingRules.projectId, projectId))
      .orderBy(schema.routingRules.priority);

    res.json({ reloaded: true, rulesLoaded: rules.length, rules });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// GET /rules — list cached routing rules
// ---------------------------------------------------------------------------

router.get('/rules', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;

    const rules = await getDb()
      .select()
      .from(schema.routingRules)
      .where(eq(schema.routingRules.projectId, projectId))
      .orderBy(schema.routingRules.priority);

    res.json(rules);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /test — simulate full 3-tier routing (no DB side-effects except routing_log)
// ---------------------------------------------------------------------------

router.post('/test', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const { title, labels, body } = req.body as {
      title?: string;
      labels?: string[];
      body?: string;
    };

    if (!title) {
      res.status(400).json({ error: '`title` is required' });
      return;
    }

    // issueId=null → simulation mode (no real issueRun created for Tier-3)
    const result = await resolveRouteFull(
      projectId,
      { title, labels: labels ?? [], body: body ?? '' },
      null,
    );

    res.json({
      matched: result.tier !== null,
      tier: result.tier,
      agentName: result.agentName,
      agentId: result.agentId,
      score: result.score,
      reasoning: result.reasoning,
      matchedRule: result.matchedRule,
      specifierRunId: result.specifierRunId,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// GET /log — last 100 routing decisions
// ---------------------------------------------------------------------------

router.get('/log', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const db = getDb();

    const logRows = await db
      .select({
        id: schema.routingLog.id,
        issueId: schema.routingLog.issueId,
        issueTitle: schema.issues.title,
        tier: schema.routingLog.tier,
        resolvedAgent: schema.routingLog.resolvedAgent,
        matchedRule: schema.routingLog.matchedRule,
        score: schema.routingLog.score,
        reasoning: schema.routingLog.reasoning,
        specifierRunId: schema.routingLog.specifierRunId,
        decidedAt: schema.routingLog.decidedAt,
      })
      .from(schema.routingLog)
      .leftJoin(schema.issues, eq(schema.routingLog.issueId, schema.issues.id))
      .where(eq(schema.routingLog.projectId, projectId))
      .orderBy(desc(schema.routingLog.decidedAt))
      .limit(100);

    const loggedIssueIds = new Set(logRows.map((row) => row.issueId).filter((id): id is string => Boolean(id)));

    // Older pickup-ready decisions were persisted only on issue_runs. Fold those
    // into the decision feed so the log explains the same runs visible in Flow.
    const runRows = await db
      .select({
        id: schema.issueRuns.id,
        issueId: schema.issueRuns.issueId,
        issueTitle: schema.issues.title,
        tier: schema.issueRuns.routingTier,
        resolvedAgent: schema.agents.name,
        score: schema.issueRuns.routingScore,
        reasoning: schema.issueRuns.routingReasoning,
        decidedAt: schema.issueRuns.createdAt,
      })
      .from(schema.issueRuns)
      .innerJoin(schema.issues, eq(schema.issueRuns.issueId, schema.issues.id))
      .innerJoin(schema.agents, eq(schema.issueRuns.agentId, schema.agents.id))
      .where(and(
        eq(schema.issues.projectId, projectId),
        sql`${schema.issueRuns.routingTier} IS NOT NULL`,
      ))
      .orderBy(desc(schema.issueRuns.createdAt))
      .limit(100);

    const entries = [
      ...logRows.map((row) => ({
        id: row.id,
        timestamp: row.decidedAt,
        issueId: row.issueId,
        issueTitle: row.issueTitle ?? (row.issueId ? 'Deleted card' : 'Routing preview (not a saved card)'),
        tier: tierLabel(row.tier),
        matchedRule: row.matchedRule ?? undefined,
        agentAssigned: row.resolvedAgent ?? undefined,
        agentName: row.resolvedAgent ?? undefined,
        score: numberOrNull(row.score) ?? undefined,
        reasoning: row.reasoning,
        specifierRunId: row.specifierRunId ?? undefined,
        source: 'routing_log' as const,
      })),
      ...runRows
        .filter((row) => !loggedIssueIds.has(row.issueId))
        .map((row) => ({
          id: `run:${row.id}`,
          timestamp: row.decidedAt,
          issueId: row.issueId,
          issueTitle: row.issueTitle,
          tier: tierLabel(row.tier),
          matchedRule: runMatchedRule(row.tier, row.reasoning),
          agentAssigned: row.resolvedAgent,
          agentName: row.resolvedAgent,
          score: numberOrNull(row.score) ?? undefined,
          reasoning: row.reasoning,
          source: 'issue_run' as const,
        })),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 100);

    res.json(entries);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// GET /stats — tier 1/2/3 counts and avg score
// ---------------------------------------------------------------------------

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const db = getDb();

    const logRows = await db
      .select({
        issueId: schema.routingLog.issueId,
        tier: schema.routingLog.tier,
        score: schema.routingLog.score,
      })
      .from(schema.routingLog)
      .where(eq(schema.routingLog.projectId, projectId));

    const loggedIssueIds = new Set(logRows.map((row) => row.issueId).filter((id): id is string => Boolean(id)));

    const runRows = await db
      .select({
        issueId: schema.issueRuns.issueId,
        tier: schema.issueRuns.routingTier,
        score: schema.issueRuns.routingScore,
      })
      .from(schema.issueRuns)
      .innerJoin(schema.issues, eq(schema.issueRuns.issueId, schema.issues.id))
      .where(and(
        eq(schema.issues.projectId, projectId),
        sql`${schema.issueRuns.routingTier} IS NOT NULL`,
      ));

    const decisions = [
      ...logRows.filter((row) => row.issueId != null),
      ...runRows.filter((row) => !loggedIssueIds.has(row.issueId)),
    ];

    let tier1Count = 0;
    let tier2Count = 0;
    let tier3Count = 0;
    let triageCount = 0;
    const tier2Scores: number[] = [];

    for (const row of decisions) {
      if (row.tier === 1) tier1Count++;
      else if (row.tier === 2) {
        tier2Count++;
        const score = numberOrNull(row.score);
        if (score != null) tier2Scores.push(score);
      } else if (row.tier === 3) tier3Count++;
      else triageCount++;
    }

    const tier2AvgScore = tier2Scores.length > 0
      ? tier2Scores.reduce((sum, score) => sum + score, 0) / tier2Scores.length
      : undefined;

    res.json({
      total: decisions.length,
      tier1Count,
      tier2Count,
      tier2AvgScore,
      tier3Count,
      triageCount,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /keywords/refresh — re-extract charter keywords for all agents
// ---------------------------------------------------------------------------

router.post('/keywords/refresh', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    await refreshAgentKeywords(projectId);
    res.json({ refreshed: true });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;

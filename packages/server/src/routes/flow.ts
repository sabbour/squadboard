/**
 * routes/flow.ts — Phase 12 flow visualisation endpoints.
 *
 * GET /api/projects/:projectId/issues/:issueId/flow
 *   → per-task DAG payload (see services/flow.ts:IssueFlow).
 *
 * GET /api/projects/:projectId/flow
 *   → project-level kanban-with-active-run payload
 *     (see services/flow.ts:ProjectFlow).
 *
 * Phase 12 reframe — agent-centric endpoints (new, non-breaking):
 *
 * GET /api/projects/:projectId/flow/agents
 *   → agent-instance graph for flow visualisation.
 *   Response: { ok: true, data: { agents: FlowAgent[] } }
 *
 * GET /api/projects/:projectId/flow/lineage
 *   → directed-edge set for lineage graph.
 *   Response: { ok: true, data: { edges: FlowLineageEdge[] } }
 *
 * GET /api/projects/:projectId/flow/graph
 *   → combined agents + edges in one round-trip (primary client endpoint).
 *   Response: { ok: true, data: { agents: FlowAgent[], edges: FlowLineageEdge[] } }
 *
 * Both endpoints are read-only aggregators. Phase 16 will add edit
 * affordances on top of these payloads.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import * as flowService from '../services/flow.js';
import * as flowAgentsService from '../services/flow-agents.js';

function handleError(res: Response, err: unknown) {
  const status = (err as { status?: unknown })?.status;
  if (err instanceof Error && typeof status === 'number') {
    res.status(status).json({ error: err.message });
    return;
  }
  console.error('[flow] unhandled error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
}

// ---------------------------------------------------------------------------
// Project-scoped router — mounted at /api/projects/:projectId/flow
// ---------------------------------------------------------------------------

export const projectFlowRouter = Router({ mergeParams: true });

// ── Phase 12 (original): kanban-with-active-run project view ───────────────
projectFlowRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const payload = await flowService.getProjectFlow(projectId);
    res.json(payload);
  } catch (err) {
    handleError(res, err);
  }
});

// ── Phase 12 reframe: agent-instance graph ─────────────────────────────────
projectFlowRouter.get('/agents', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const data = await flowAgentsService.getFlowAgents(projectId);
    res.json({ ok: true, data });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Phase 12 reframe: lineage edge set ─────────────────────────────────────
projectFlowRouter.get('/lineage', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const data = await flowAgentsService.getFlowLineage(projectId);
    res.json({ ok: true, data });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Phase 12 reframe: combined graph (agents + edges, one round-trip) ───────
projectFlowRouter.get('/graph', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const [agentsResult, lineageResult] = await Promise.all([
      flowAgentsService.getFlowAgents(projectId),
      flowAgentsService.getFlowLineage(projectId),
    ]);
    res.json({ ok: true, data: { agents: agentsResult.agents, edges: lineageResult.edges } });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Issue-scoped router — mounted at /api/projects/:projectId/issues/:issueId/flow
// ---------------------------------------------------------------------------

export const issueFlowRouter = Router({ mergeParams: true });

issueFlowRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId, issueId } = req.params as Record<string, string>;
    const payload = await flowService.getIssueFlow(projectId, issueId);
    res.json(payload);
  } catch (err) {
    handleError(res, err);
  }
});

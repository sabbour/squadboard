/**
 * routing.ts — REST endpoints for Tier 1 routing management (Demo 5)
 *
 * POST /api/projects/:projectId/routing/reload   — reload routing.md from disk
 * GET  /api/projects/:projectId/routing/rules    — list cached routing rules
 * POST /api/projects/:projectId/routing/test     — test-resolve: {title, labels, body} → agent
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { loadRoutingRules, resolveRoute } from '../engine/router.js';

const router = Router({ mergeParams: true });

function handleError(res: Response, err: unknown) {
  if (err instanceof Error && (err as NodeJS.ErrnoException & { status?: number }).status) {
    const s = (err as { status: number }).status;
    res.status(s).json({ error: err.message });
    return;
  }
  console.error('[routing] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

// ---------------------------------------------------------------------------
// POST /reload — reload routing.md from disk
// ---------------------------------------------------------------------------

router.post('/reload', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

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
    const { projectId } = req.params;

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
// POST /test — test-resolve an issue against cached rules
// ---------------------------------------------------------------------------

router.post('/test', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { title, labels, body } = req.body as {
      title?: string;
      labels?: string[];
      body?: string;
    };

    if (!title) {
      res.status(400).json({ error: '`title` is required' });
      return;
    }

    const match = await resolveRoute(projectId, {
      title,
      labels: labels ?? [],
      body: body ?? '',
    });

    if (!match) {
      res.json({ matched: false, agentName: null, rule: null });
      return;
    }

    res.json({ matched: true, agentName: match.agentName, rule: match.rule });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;

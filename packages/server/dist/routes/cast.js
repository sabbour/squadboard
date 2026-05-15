/**
 * POST /api/projects/:projectId/cast
 *   Body: { title, body?, labels? }
 *   Runs the full 3-tier routing pipeline and returns the suggested agent + reasoning.
 *   Persists to routing_log via resolveRouteFull's internal logger.
 *
 *   This is a thin "Cast this issue" UI layer over the existing router engine —
 *   not a separate matcher. Keeps suggestions consistent with production routing.
 */
import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { resolveRouteFull } from '../engine/router.js';
import { getDb, schema } from '../db/index.js';
const router = Router({ mergeParams: true });
router.post('/', async (req, res) => {
    const { projectId } = req.params;
    const { title, body, labels } = (req.body ?? {});
    if (!title || typeof title !== 'string' || !title.trim()) {
        res.status(400).json({ ok: false, error: '`title` is required' });
        return;
    }
    const db = getDb();
    const project = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
    if (project.length === 0) {
        res.status(404).json({ ok: false, error: 'Project not found' });
        return;
    }
    const issue = {
        title: title.trim(),
        body: body?.trim() || undefined,
        labels: Array.isArray(labels) ? labels.filter((l) => typeof l === 'string') : [],
    };
    const result = await resolveRouteFull(projectId, issue, null);
    // Resolve agentId from agentName if the router only returned a name (tier 1).
    let agentId = result.agentId;
    if (!agentId && result.agentName) {
        const [agent] = await db
            .select({ id: schema.agents.id })
            .from(schema.agents)
            .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.name, result.agentName)))
            .limit(1);
        agentId = agent?.id ?? null;
    }
    res.json({
        ok: true,
        data: {
            tier: result.tier,
            agentName: result.agentName,
            agentId,
            score: result.score,
            reasoning: result.reasoning,
            matchedRule: result.matchedRule,
        },
    });
});
export default router;
//# sourceMappingURL=cast.js.map
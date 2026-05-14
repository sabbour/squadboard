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
import { eq, desc, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { loadRoutingRules, resolveRouteFull, refreshAgentKeywords } from '../engine/router.js';
const router = Router({ mergeParams: true });
function handleError(res, err) {
    if (err instanceof Error && err.status) {
        const s = err.status;
        res.status(s).json({ error: err.message });
        return;
    }
    console.error('[routing] unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
}
// ---------------------------------------------------------------------------
// POST /reload — reload routing.md from disk
// ---------------------------------------------------------------------------
router.post('/reload', async (req, res) => {
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
    }
    catch (err) {
        handleError(res, err);
    }
});
// ---------------------------------------------------------------------------
// GET /rules — list cached routing rules
// ---------------------------------------------------------------------------
router.get('/rules', async (req, res) => {
    try {
        const { projectId } = req.params;
        const rules = await getDb()
            .select()
            .from(schema.routingRules)
            .where(eq(schema.routingRules.projectId, projectId))
            .orderBy(schema.routingRules.priority);
        res.json(rules);
    }
    catch (err) {
        handleError(res, err);
    }
});
// ---------------------------------------------------------------------------
// POST /test — simulate full 3-tier routing (no DB side-effects except routing_log)
// ---------------------------------------------------------------------------
router.post('/test', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { title, labels, body } = req.body;
        if (!title) {
            res.status(400).json({ error: '`title` is required' });
            return;
        }
        // issueId=null → simulation mode (no real issueRun created for Tier-3)
        const result = await resolveRouteFull(projectId, { title, labels: labels ?? [], body: body ?? '' }, null);
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
    }
    catch (err) {
        handleError(res, err);
    }
});
// ---------------------------------------------------------------------------
// GET /log — last 100 routing decisions
// ---------------------------------------------------------------------------
router.get('/log', async (req, res) => {
    try {
        const { projectId } = req.params;
        const rows = await getDb()
            .select()
            .from(schema.routingLog)
            .where(eq(schema.routingLog.projectId, projectId))
            .orderBy(desc(schema.routingLog.decidedAt))
            .limit(100);
        res.json(rows);
    }
    catch (err) {
        handleError(res, err);
    }
});
// ---------------------------------------------------------------------------
// GET /stats — tier 1/2/3 counts and avg score
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res) => {
    try {
        const { projectId } = req.params;
        const db = getDb();
        const [totals] = await db
            .select({ total: sql `count(*)::int` })
            .from(schema.routingLog)
            .where(eq(schema.routingLog.projectId, projectId));
        const tierCounts = await db
            .select({
            tier: schema.routingLog.tier,
            count: sql `count(*)::int`,
            avgScore: sql `avg(score::numeric)`,
        })
            .from(schema.routingLog)
            .where(eq(schema.routingLog.projectId, projectId))
            .groupBy(schema.routingLog.tier);
        // Build tier breakdown (null tier = triage fallback)
        const breakdown = {
            tier1: { count: 0, avgScore: null },
            tier2: { count: 0, avgScore: null },
            tier3: { count: 0, avgScore: null },
            triage: { count: 0, avgScore: null },
        };
        for (const row of tierCounts) {
            const key = row.tier === 1 ? 'tier1'
                : row.tier === 2 ? 'tier2'
                    : row.tier === 3 ? 'tier3'
                        : 'triage';
            breakdown[key] = {
                count: row.count,
                avgScore: row.avgScore != null ? parseFloat(row.avgScore) : null,
            };
        }
        res.json({
            total: totals?.total ?? 0,
            ...breakdown,
        });
    }
    catch (err) {
        handleError(res, err);
    }
});
// ---------------------------------------------------------------------------
// POST /keywords/refresh — re-extract charter keywords for all agents
// ---------------------------------------------------------------------------
router.post('/keywords/refresh', async (req, res) => {
    try {
        const { projectId } = req.params;
        await refreshAgentKeywords(projectId);
        res.json({ refreshed: true });
    }
    catch (err) {
        handleError(res, err);
    }
});
export default router;
//# sourceMappingURL=routing.js.map
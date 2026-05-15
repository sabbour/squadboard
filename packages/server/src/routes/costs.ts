import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { getCostSummary, type CostSource } from '../sdk/cost-tracker.js';
import { BudgetGuard } from '../sdk/budget-guard.js';

const router = Router({ mergeParams: true });

const VALID_SOURCES: CostSource[] = ['run', 'live_session', 'consult'];

/**
 * GET /api/projects/:id/costs
 *
 * Returns a cost summary for the project broken down by agent and model,
 * for both the current calendar month (MTD) and all time.
 *
 * Query params:
 *   ?sources=run,live_session,consult   filter included spend sources.
 *                                        defaults to run,live_session
 *                                        (consult is opt-in so exploratory
 *                                        thinking doesn't pollute run charts)
 */
router.get('/', async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const db = getDb();

    const sourcesRaw = (req.query.sources as string | undefined) ?? '';
    const sources = sourcesRaw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is CostSource => VALID_SOURCES.includes(s as CostSource));

    const summary = await getCostSummary(db, id, sources.length ? { sources } : {});
    res.json(summary);
  } catch (err: unknown) {
    console.error('[costs] GET /costs error:', err);
    res.status(500).json({ error: 'Failed to fetch cost summary' });
  }
});

/**
 * GET /api/projects/:id/costs/budget
 *
 * Returns the project's budget config, MTD spend, and percentage used.
 */
router.get('/budget', async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const info = await BudgetGuard.getInfo(id);
    res.json({
      projectId: id,
      budgetUsd: info.budgetUsd,
      spendUsd: info.spendUsd,
      percentUsed: info.percentUsed,
      isConfigured: info.budgetUsd != null,
    });
  } catch (err: unknown) {
    console.error('[costs] GET /costs/budget error:', err);
    res.status(500).json({ error: 'Failed to fetch budget info' });
  }
});

/**
 * PUT /api/projects/:id/costs/budget
 *
 * Set or update the monthly budget for a project.
 * Body: { budgetUsd: number | null }  (null clears the budget)
 */
router.put('/budget', async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const { budgetUsd } = req.body as { budgetUsd: number | null };

    const db = getDb();
    await db.execute(sql`
      UPDATE projects
      SET monthly_budget_usd = ${budgetUsd ?? null}, updated_at = NOW()
      WHERE id = ${id}
    `);

    const info = await BudgetGuard.getInfo(id);
    res.json({
      projectId: id,
      budgetUsd: info.budgetUsd,
      spendUsd: info.spendUsd,
      percentUsed: info.percentUsed,
      isConfigured: info.budgetUsd != null,
    });
  } catch (err: unknown) {
    console.error('[costs] PUT /costs/budget error:', err);
    res.status(500).json({ error: 'Failed to update budget' });
  }
});

export default router;

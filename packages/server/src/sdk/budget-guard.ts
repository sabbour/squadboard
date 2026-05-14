import { sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { getMtdSpend } from './cost-tracker.js';

/**
 * Thrown when a project's month-to-date spend has reached or exceeded
 * its configured monthly budget.
 */
export class BudgetExceededError extends Error {
  constructor(
    public readonly projectId: string,
    public readonly budgetUsd: number,
    public readonly spendUsd: number,
  ) {
    super(
      `Budget exceeded for project ${projectId}: ` +
        `$${spendUsd.toFixed(4)} spent of $${budgetUsd.toFixed(2)} monthly budget`,
    );
    this.name = 'BudgetExceededError';
  }
}

/**
 * BudgetGuard — opt-in project-level monthly spend cap.
 *
 * Call `BudgetGuard.check(projectId)` before launching any agent run.
 * If no `monthly_budget_usd` is set on the project, the check is skipped (opt-in).
 * If MTD spend >= budget, throws `BudgetExceededError`.
 */
export class BudgetGuard {
  static async check(projectId: string): Promise<void> {
    const db = getDb();

    // Look up the project's optional budget
    const result = await db.execute(sql`
      SELECT monthly_budget_usd FROM projects WHERE id = ${projectId} LIMIT 1
    `);
    const rows = result.rows as Array<{ monthly_budget_usd: string | null }>;
    const budgetRaw = rows[0]?.monthly_budget_usd;

    // No budget configured → guard is disabled for this project
    if (budgetRaw == null) return;

    const budgetUsd = parseFloat(budgetRaw);
    if (isNaN(budgetUsd) || budgetUsd <= 0) return;

    const spendUsd = await getMtdSpend(db, projectId);

    if (spendUsd >= budgetUsd) {
      throw new BudgetExceededError(projectId, budgetUsd, spendUsd);
    }
  }

  /** Returns budget info for a project (null budget means not configured). */
  static async getInfo(projectId: string): Promise<{
    budgetUsd: number | null;
    spendUsd: number;
    percentUsed: number | null;
  }> {
    const db = getDb();

    const result = await db.execute(sql`
      SELECT monthly_budget_usd FROM projects WHERE id = ${projectId} LIMIT 1
    `);
    const rows = result.rows as Array<{ monthly_budget_usd: string | null }>;
    const budgetRaw = rows[0]?.monthly_budget_usd;
    const budgetUsd = budgetRaw != null ? parseFloat(budgetRaw) : null;

    const spendUsd = await getMtdSpend(db, projectId);
    const percentUsed =
      budgetUsd != null && budgetUsd > 0
        ? Math.min(100, (spendUsd / budgetUsd) * 100)
        : null;

    return { budgetUsd, spendUsd, percentUsed };
  }
}

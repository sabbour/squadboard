import { sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { getMtdSpend } from './cost-tracker.js';
/**
 * Thrown when a project's month-to-date spend has reached or exceeded
 * its configured monthly budget.
 */
export class BudgetExceededError extends Error {
    projectId;
    budgetUsd;
    spendUsd;
    constructor(projectId, budgetUsd, spendUsd) {
        super(`Budget exceeded for project ${projectId}: ` +
            `$${spendUsd.toFixed(4)} spent of $${budgetUsd.toFixed(2)} monthly budget`);
        this.projectId = projectId;
        this.budgetUsd = budgetUsd;
        this.spendUsd = spendUsd;
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
    static async check(projectId) {
        const db = getDb();
        // Look up the project's optional budget
        const result = await db.execute(sql `
      SELECT monthly_budget_usd FROM projects WHERE id = ${projectId} LIMIT 1
    `);
        const rows = result.rows;
        const budgetRaw = rows[0]?.monthly_budget_usd;
        // No budget configured → guard is disabled for this project
        if (budgetRaw == null)
            return;
        const budgetUsd = parseFloat(budgetRaw);
        if (isNaN(budgetUsd) || budgetUsd <= 0)
            return;
        const spendUsd = await getMtdSpend(db, projectId);
        if (spendUsd >= budgetUsd) {
            throw new BudgetExceededError(projectId, budgetUsd, spendUsd);
        }
    }
    /** Returns budget info for a project (null budget means not configured). */
    static async getInfo(projectId) {
        const db = getDb();
        const result = await db.execute(sql `
      SELECT monthly_budget_usd FROM projects WHERE id = ${projectId} LIMIT 1
    `);
        const rows = result.rows;
        const budgetRaw = rows[0]?.monthly_budget_usd;
        const budgetUsd = budgetRaw != null ? parseFloat(budgetRaw) : null;
        const spendUsd = await getMtdSpend(db, projectId);
        const percentUsed = budgetUsd != null && budgetUsd > 0
            ? Math.min(100, (spendUsd / budgetUsd) * 100)
            : null;
        return { budgetUsd, spendUsd, percentUsed };
    }
}
//# sourceMappingURL=budget-guard.js.map
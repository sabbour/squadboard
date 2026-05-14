/**
 * Thrown when a project's month-to-date spend has reached or exceeded
 * its configured monthly budget.
 */
export declare class BudgetExceededError extends Error {
    readonly projectId: string;
    readonly budgetUsd: number;
    readonly spendUsd: number;
    constructor(projectId: string, budgetUsd: number, spendUsd: number);
}
/**
 * BudgetGuard — opt-in project-level monthly spend cap.
 *
 * Call `BudgetGuard.check(projectId)` before launching any agent run.
 * If no `monthly_budget_usd` is set on the project, the check is skipped (opt-in).
 * If MTD spend >= budget, throws `BudgetExceededError`.
 */
export declare class BudgetGuard {
    static check(projectId: string): Promise<void>;
    /** Returns budget info for a project (null budget means not configured). */
    static getInfo(projectId: string): Promise<{
        budgetUsd: number | null;
        spendUsd: number;
        percentUsed: number | null;
    }>;
}
//# sourceMappingURL=budget-guard.d.ts.map
import type { DrizzleDb } from '../db/index.js';
export declare class CostTracker {
    private readonly issueRunId;
    private readonly db;
    constructor(issueRunId: string, db: DrizzleDb);
    /** Legacy single-value record (kept for backward compat with existing callers). */
    record(tokensUsed: number, costUsd: string): Promise<void>;
    /** Full granular cost record with input/output split. */
    recordCost(inputTokens: number, outputTokens: number, modelId: string): Promise<void>;
    /** Accumulate cost incrementally (for streaming runs). */
    accumulate(deltaTokens: number, deltaCostUsd: string): Promise<void>;
}
export interface CostByAgent {
    agentId: string;
    agentName: string;
    runCount: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
}
export interface CostByModel {
    modelId: string;
    runCount: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
}
export interface CostSummary {
    projectId: string;
    /** Month-to-date (calendar month of query time) */
    mtd: {
        totalInputTokens: number;
        totalOutputTokens: number;
        totalCostUsd: number;
        byAgent: CostByAgent[];
    };
    /** All-time totals */
    allTime: {
        totalInputTokens: number;
        totalOutputTokens: number;
        totalCostUsd: number;
        byAgent: CostByAgent[];
    };
}
export declare function getCostSummary(db: DrizzleDb, projectId: string): Promise<CostSummary>;
/** Compute MTD spend for a project (used by BudgetGuard). */
export declare function getMtdSpend(db: DrizzleDb, projectId: string): Promise<number>;
//# sourceMappingURL=cost-tracker.d.ts.map
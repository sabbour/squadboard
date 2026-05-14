import type { DrizzleDb } from '../db/index.js';
import { issueRuns } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

export class CostTracker {
  constructor(
    private readonly issueRunId: string,
    private readonly db: DrizzleDb,
  ) {}

  async record(tokensUsed: number, costUsd: string): Promise<void> {
    await this.db
      .update(issueRuns)
      .set({ costTokens: tokensUsed, costUsd })
      .where(eq(issueRuns.id, this.issueRunId));
  }

  async accumulate(deltaTokens: number, deltaCostUsd: string): Promise<void> {
    const delta = parseFloat(deltaCostUsd);
    await this.db
      .update(issueRuns)
      .set({
        costTokens: sql`COALESCE(${issueRuns.costTokens}, 0) + ${deltaTokens}`,
        costUsd: sql`(COALESCE(${issueRuns.costUsd}::numeric, 0) + ${delta})::text`,
      })
      .where(eq(issueRuns.id, this.issueRunId));
  }
}

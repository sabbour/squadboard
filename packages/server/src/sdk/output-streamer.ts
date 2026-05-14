import type { DrizzleDb } from '../db/index.js';
import { issueRuns } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

export class OutputStreamer {
  private buffer = '';

  constructor(
    private readonly issueRunId: string,
    private readonly db: DrizzleDb,
  ) {}

  async write(chunk: string): Promise<void> {
    this.buffer += chunk;
    await this.db
      .update(issueRuns)
      .set({ output: sql`COALESCE(${issueRuns.output}, '') || ${chunk}` })
      .where(eq(issueRuns.id, this.issueRunId));
  }

  async flush(): Promise<void> {
    await this.db
      .update(issueRuns)
      .set({ output: this.buffer })
      .where(eq(issueRuns.id, this.issueRunId));
  }
}

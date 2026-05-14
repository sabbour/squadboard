/**
 * OutputStreamer — Demo 4 / Demo 12.
 *
 * Demo 4: writes run output to Postgres (append via COALESCE).
 * Demo 12: dual-write — also pushes `run.output` WS events via eventBus.
 *
 * Use `streamChunk` from realtime/live-output.ts when you have a projectId.
 * Use this class when constructed from the engine (which knows issueRunId).
 * The engine calls `write(chunk, projectId)` to get WS push for free.
 */
import type { DrizzleDb } from '../db/index.js';
import { issueRuns } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { eventBus } from '../realtime/event-bus.js';

export class OutputStreamer {
  private buffer = '';

  constructor(
    private readonly issueRunId: string,
    private readonly db: DrizzleDb,
    /** Optional: if provided, each chunk also fires a WS push via eventBus. */
    private readonly projectId?: string,
  ) {}

  async write(chunk: string): Promise<void> {
    this.buffer += chunk;
    await this.db
      .update(issueRuns)
      .set({ output: sql`COALESCE(${issueRuns.output}, '') || ${chunk}` })
      .where(eq(issueRuns.id, this.issueRunId));

    // WS push: emit run.output event if projectId is known
    if (this.projectId) {
      eventBus.emitRunEvent('run.output', this.projectId, {
        runId: this.issueRunId,
        chunk,
      });
    }
  }

  async flush(): Promise<void> {
    await this.db
      .update(issueRuns)
      .set({ output: this.buffer })
      .where(eq(issueRuns.id, this.issueRunId));
  }
}

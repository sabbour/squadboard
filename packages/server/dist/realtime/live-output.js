/**
 * live-output.ts — Demo 12: dual-write run output to DB + WS.
 *
 * `streamChunk` appends a chunk to the DB (via COALESCE concat) AND
 * emits a `run.output` event through the eventBus so all subscribed
 * WS clients receive it instantly.
 *
 * The SSE /stream endpoint in routes/runs.ts is kept as a fallback
 * for clients that don't support WebSockets.
 */
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { issueRuns } from '../db/schema.js';
import { eventBus } from './event-bus.js';
/**
 * Appends `chunk` to the run's output in Postgres AND pushes a
 * `run.output` WS event to all clients subscribed to `projectId`.
 */
export async function streamChunk(runId, projectId, chunk) {
    const db = getDb();
    await db
        .update(issueRuns)
        .set({ output: sql `COALESCE(${issueRuns.output}, '') || ${chunk}` })
        .where(eq(issueRuns.id, runId));
    eventBus.emitRunEvent('run.output', projectId, { runId, chunk });
}
//# sourceMappingURL=live-output.js.map
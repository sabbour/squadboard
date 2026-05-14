import { issueRuns } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { eventBus } from '../realtime/event-bus.js';
export class OutputStreamer {
    issueRunId;
    db;
    projectId;
    buffer = '';
    constructor(issueRunId, db, 
    /** Optional: if provided, each chunk also fires a WS push via eventBus. */
    projectId) {
        this.issueRunId = issueRunId;
        this.db = db;
        this.projectId = projectId;
    }
    async write(chunk) {
        this.buffer += chunk;
        await this.db
            .update(issueRuns)
            .set({ output: sql `COALESCE(${issueRuns.output}, '') || ${chunk}` })
            .where(eq(issueRuns.id, this.issueRunId));
        // WS push: emit run.output event if projectId is known
        if (this.projectId) {
            eventBus.emitRunEvent('run.output', this.projectId, {
                runId: this.issueRunId,
                chunk,
            });
        }
    }
    async flush() {
        await this.db
            .update(issueRuns)
            .set({ output: this.buffer })
            .where(eq(issueRuns.id, this.issueRunId));
    }
}
//# sourceMappingURL=output-streamer.js.map
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
export declare class OutputStreamer {
    private readonly issueRunId;
    private readonly db;
    /** Optional: if provided, each chunk also fires a WS push via eventBus. */
    private readonly projectId?;
    private buffer;
    constructor(issueRunId: string, db: DrizzleDb, 
    /** Optional: if provided, each chunk also fires a WS push via eventBus. */
    projectId?: string | undefined);
    write(chunk: string): Promise<void>;
    flush(): Promise<void>;
}
//# sourceMappingURL=output-streamer.d.ts.map
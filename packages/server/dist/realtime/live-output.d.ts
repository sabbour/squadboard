/**
 * Appends `chunk` to the run's output in Postgres AND pushes a
 * `run.output` WS event to all clients subscribed to `projectId`.
 */
export declare function streamChunk(runId: string, projectId: string, chunk: string): Promise<void>;
//# sourceMappingURL=live-output.d.ts.map
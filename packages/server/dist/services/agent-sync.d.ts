export interface SyncResult {
    added: number;
    updated: number;
    removed: number;
}
/**
 * Scan `.squad/agents/` for a project and sync to DB.
 *
 * For each sub-folder in <squadPath>/agents/:
 *   - Read charter.md and parse metadata
 *   - Upsert agents row (matched on projectId + name)
 *   - Detect charter changes via md5 hash
 *
 * Agents in DB that no longer have a folder on disk are marked 'retired'.
 */
export declare function syncAgentsFromDisk(projectId: string, squadPath: string): Promise<SyncResult>;
/**
 * Watch `.squad/agents/` for file changes and trigger a re-sync.
 * Uses chokidar for cross-platform file watching.
 *
 * @returns A cleanup function that stops the watcher.
 */
export declare function watchAgents(projectId: string, squadPath: string): Promise<() => void>;
//# sourceMappingURL=agent-sync.d.ts.map
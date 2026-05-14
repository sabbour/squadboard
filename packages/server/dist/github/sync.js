/**
 * github/sync.ts — Demo 15: per-project GitHub sync engine.
 *
 * GitHubSync handles push (local → GitHub) and pull (GitHub → local) for issues
 * and comments. Conflict resolution uses last-write-wins by updatedAt.
 */
import { getDb, getPool, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { GitHubClient } from './client.js';
// ─── Active sync loops registry ───────────────────────────────────────────────
const activeSyncLoops = new Map();
// ─── Logging helper ───────────────────────────────────────────────────────────
async function logSync(entry) {
    const pool = getPool();
    try {
        await pool.query(`INSERT INTO github_sync_log
         (id, project_id, direction, entity_type, entity_id, github_number, status, error_msg, synced_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())`, [
            entry.projectId,
            entry.direction,
            entry.entityType,
            entry.entityId,
            entry.githubNumber ?? null,
            entry.status,
            entry.errorMsg ?? null,
        ]);
    }
    catch (err) {
        console.error('[github-sync] failed to write sync log:', err);
    }
}
// ─── GitHubSync class ─────────────────────────────────────────────────────────
export class GitHubSync {
    projectId;
    client;
    constructor(projectId, client) {
        this.projectId = projectId;
        this.client = client;
    }
    /**
     * Build a GitHubSync from a stored project row.
     * Picks PAT or App auth based on githubAuthType (null → 'pat').
     */
    static async fromProject(projectId, project) {
        const authType = project.githubAuthType ?? 'pat';
        const owner = project.githubOwner;
        const repo = project.githubRepo;
        let client;
        if (authType === 'app') {
            client = await GitHubClient.fromApp(project.githubAppId, project.githubAppInstallationId, project.githubAppPrivateKey, owner, repo);
        }
        else {
            client = GitHubClient.fromPat(project.githubToken, owner, repo);
        }
        return new GitHubSync(projectId, client);
    }
    /**
     * Push a local issue to GitHub.
     * - If the issue has no githubIssueNumber → create a new GitHub issue.
     * - If it already has one → update the existing GitHub issue.
     * Upserts githubIssueNumber, githubIssueUrl, githubNodeId onto the local row.
     */
    async pushIssue(issue) {
        const db = getDb();
        const body = issue.body ?? '';
        const ghState = issue.status === 'done' ? 'closed' : 'open';
        try {
            if (issue.githubIssueNumber == null) {
                // Create
                const ref = await this.client.createIssue(issue.title, body);
                await db
                    .update(schema.issues)
                    .set({
                    githubIssueNumber: ref.number,
                    githubIssueUrl: ref.url,
                    githubNodeId: ref.nodeId,
                    updatedAt: new Date(),
                })
                    .where(eq(schema.issues.id, issue.id));
                await logSync({
                    projectId: this.projectId,
                    direction: 'push',
                    entityType: 'issue',
                    entityId: issue.id,
                    githubNumber: ref.number,
                    status: 'ok',
                });
            }
            else {
                // Update
                await this.client.updateIssue(issue.githubIssueNumber, {
                    title: issue.title,
                    body,
                    state: ghState,
                });
                await logSync({
                    projectId: this.projectId,
                    direction: 'push',
                    entityType: 'issue',
                    entityId: issue.id,
                    githubNumber: issue.githubIssueNumber,
                    status: 'ok',
                });
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await logSync({
                projectId: this.projectId,
                direction: 'push',
                entityType: 'issue',
                entityId: issue.id,
                githubNumber: issue.githubIssueNumber,
                status: 'error',
                errorMsg: msg,
            });
            throw err;
        }
    }
    /**
     * Mirror a local comment to GitHub.
     * If the comment already has a githubCommentId → skip (immutable once posted).
     * Otherwise post a new comment and store the ID.
     */
    async pushComment(comment, githubIssueNumber) {
        const db = getDb();
        // Comments are immutable on GitHub (we don't edit them after posting)
        if (comment.githubCommentId != null)
            return;
        try {
            const ghComment = await this.client.addComment(githubIssueNumber, comment.body);
            await db
                .update(schema.comments)
                .set({ githubCommentId: String(ghComment.id) })
                .where(eq(schema.comments.id, comment.id));
            await logSync({
                projectId: this.projectId,
                direction: 'push',
                entityType: 'comment',
                entityId: comment.id,
                githubNumber: githubIssueNumber,
                status: 'ok',
            });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await logSync({
                projectId: this.projectId,
                direction: 'push',
                entityType: 'comment',
                entityId: comment.id,
                githubNumber: githubIssueNumber,
                status: 'error',
                errorMsg: msg,
            });
            throw err;
        }
    }
    /**
     * Pull GitHub issues updated since `since` and apply to local DB.
     * Uses last-write-wins conflict resolution (resolveConflict).
     * Updates githubSyncLastAt on the project after a successful pull.
     */
    async pullChanges(since) {
        const db = getDb();
        let ghIssues;
        try {
            ghIssues = await this.client.listIssues(since);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await logSync({
                projectId: this.projectId,
                direction: 'pull',
                entityType: 'batch',
                entityId: 'all',
                status: 'error',
                errorMsg: msg,
            });
            throw err;
        }
        for (const ghIssue of ghIssues) {
            try {
                // Find a local issue that is already linked to this GitHub issue number
                const [localIssue] = await db
                    .select()
                    .from(schema.issues)
                    .where(and(eq(schema.issues.projectId, this.projectId), eq(schema.issues.githubIssueNumber, ghIssue.number)))
                    .limit(1);
                if (localIssue) {
                    // Conflict resolution: last-write-wins
                    const winner = this.resolveConflict(localIssue, ghIssue);
                    if (winner === 'github') {
                        await db
                            .update(schema.issues)
                            .set({
                            title: ghIssue.title,
                            body: ghIssue.body ?? '',
                            status: ghIssue.state === 'closed' ? 'done' : localIssue.status,
                            updatedAt: new Date(),
                        })
                            .where(eq(schema.issues.id, localIssue.id));
                    }
                    // If winner === 'local', we leave the local row untouched
                }
                else {
                    // New GitHub issue not yet in local DB — ingest it
                    await db.insert(schema.issues).values({
                        projectId: this.projectId,
                        title: ghIssue.title,
                        body: ghIssue.body ?? '',
                        status: ghIssue.state === 'closed' ? 'done' : 'backlog',
                        githubIssueNumber: ghIssue.number,
                        githubIssueUrl: ghIssue.html_url,
                        githubNodeId: ghIssue.node_id,
                    });
                }
                await logSync({
                    projectId: this.projectId,
                    direction: 'pull',
                    entityType: 'issue',
                    entityId: String(ghIssue.number),
                    githubNumber: ghIssue.number,
                    status: 'ok',
                });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                await logSync({
                    projectId: this.projectId,
                    direction: 'pull',
                    entityType: 'issue',
                    entityId: String(ghIssue.number),
                    githubNumber: ghIssue.number,
                    status: 'error',
                    errorMsg: msg,
                });
                // Continue processing remaining issues — one failure shouldn't abort the batch
            }
        }
        // Record last successful pull timestamp
        await db
            .update(schema.projects)
            .set({ githubSyncLastAt: new Date() })
            .where(eq(schema.projects.id, this.projectId));
    }
    /**
     * Last-write-wins conflict resolution by updatedAt.
     * Returns 'local' if local is newer (or equal), 'github' if GitHub is newer.
     */
    resolveConflict(localIssue, ghIssue) {
        const localTs = localIssue.updatedAt.getTime();
        const ghTs = new Date(ghIssue.updated_at).getTime();
        return ghTs > localTs ? 'github' : 'local';
    }
    /**
     * Push all active (non-archived) issues to GitHub.
     * Used for a full manual sync trigger.
     */
    async pushAllIssues() {
        const db = getDb();
        const issues = await db
            .select()
            .from(schema.issues)
            .where(and(eq(schema.issues.projectId, this.projectId), eq(schema.issues.archived, 0)));
        let pushed = 0;
        let errors = 0;
        for (const issue of issues) {
            try {
                await this.pushIssue(issue);
                pushed++;
            }
            catch {
                errors++;
            }
        }
        return { pushed, errors };
    }
}
// ─── Sync loop management ─────────────────────────────────────────────────────
/**
 * Start a periodic pull loop for a project.
 * Reads full project config from DB on each tick (supports PAT and App auth).
 * Returns the interval handle (also stored in activeSyncLoops map).
 */
export function startSyncLoop(projectId, intervalMs = 60_000) {
    // Stop any existing loop first
    stopSyncLoop(projectId);
    const handle = setInterval(async () => {
        try {
            const db = getDb();
            const [project] = await db
                .select()
                .from(schema.projects)
                .where(eq(schema.projects.id, projectId))
                .limit(1);
            if (!project || !project.githubSyncEnabled)
                return;
            const since = project.githubSyncLastAt?.toISOString();
            const sync = await GitHubSync.fromProject(projectId, project);
            await sync.pullChanges(since);
        }
        catch (err) {
            // Fire-and-forget: log but don't crash the loop
            console.error(`[github-sync] pull loop error for project ${projectId}:`, err);
        }
    }, intervalMs);
    activeSyncLoops.set(projectId, handle);
    console.log(`[github-sync] started sync loop for project ${projectId} (interval=${intervalMs}ms)`);
    return handle;
}
/** Stop an active sync loop for a project. */
export function stopSyncLoop(projectId) {
    const handle = activeSyncLoops.get(projectId);
    if (handle) {
        clearInterval(handle);
        activeSyncLoops.delete(projectId);
        console.log(`[github-sync] stopped sync loop for project ${projectId}`);
    }
}
/** Stop all active sync loops (called on graceful shutdown). */
export function stopAllSyncLoops() {
    for (const [projectId] of activeSyncLoops) {
        stopSyncLoop(projectId);
    }
}
//# sourceMappingURL=sync.js.map
/**
 * github/sync-hook.ts — Demo 15: event-bus listeners for GitHub sync.
 *
 * Listens to issue.created / issue.updated / issue.deleted and comment events.
 * If the project has githubSyncEnabled=true, calls GitHubSync fire-and-forget.
 * All errors are logged to github_sync_log — never thrown to the caller.
 */
import { eventBus } from '../realtime/event-bus.js';
import { getDb, getPool, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { GitHubSync } from './sync.js';
async function getGhConfig(projectId) {
    const db = getDb();
    const [project] = await db
        .select({
        githubSyncEnabled: schema.projects.githubSyncEnabled,
        githubToken: schema.projects.githubToken,
        githubOwner: schema.projects.githubOwner,
        githubRepo: schema.projects.githubRepo,
    })
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
    if (!project ||
        !project.githubSyncEnabled ||
        !project.githubToken ||
        !project.githubOwner ||
        !project.githubRepo) {
        return null;
    }
    return {
        token: project.githubToken,
        owner: project.githubOwner,
        repo: project.githubRepo,
    };
}
// ─── Helper: log error to github_sync_log ─────────────────────────────────────
async function logError(params) {
    const pool = getPool();
    try {
        await pool.query(`INSERT INTO github_sync_log
         (id, project_id, direction, entity_type, entity_id, github_number, status, error_msg, synced_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, 'error', $6, NOW())`, [
            params.projectId,
            params.direction,
            params.entityType,
            params.entityId,
            params.githubNumber ?? null,
            params.errorMsg,
        ]);
    }
    catch (err) {
        console.error('[github-sync-hook] failed to write error log:', err);
    }
}
// ─── Issue event handler ──────────────────────────────────────────────────────
async function handleIssueEvent(event) {
    const { type, projectId, payload } = event;
    const issue = payload;
    const cfg = await getGhConfig(projectId).catch(() => null);
    if (!cfg)
        return;
    const sync = new GitHubSync(projectId, cfg.token, cfg.owner, cfg.repo);
    if (type === 'issue.deleted') {
        // Close on GitHub when deleted locally (can't actually delete via API without admin)
        if (issue.githubIssueNumber != null) {
            sync
                .pushIssue({ ...issue, status: 'done' })
                .catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                logError({
                    projectId,
                    direction: 'push',
                    entityType: 'issue',
                    entityId: issue.id,
                    githubNumber: issue.githubIssueNumber,
                    errorMsg: msg,
                });
            });
        }
        return;
    }
    // issue.created or issue.updated
    sync.pushIssue(issue).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logError({
            projectId,
            direction: 'push',
            entityType: 'issue',
            entityId: issue.id,
            githubNumber: issue.githubIssueNumber ?? null,
            errorMsg: msg,
        });
    });
}
async function handleCommentEvent(event) {
    const { projectId, payload } = event;
    const { comment, githubIssueNumber } = payload;
    const cfg = await getGhConfig(projectId).catch(() => null);
    if (!cfg)
        return;
    const sync = new GitHubSync(projectId, cfg.token, cfg.owner, cfg.repo);
    sync.pushComment(comment, githubIssueNumber).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logError({
            projectId,
            direction: 'push',
            entityType: 'comment',
            entityId: comment.id,
            githubNumber: githubIssueNumber,
            errorMsg: msg,
        });
    });
}
// ─── Webhook ingest helper ────────────────────────────────────────────────────
/**
 * Ingest a raw GitHub webhook payload (issues event).
 * Creates or updates the local issue row, maintaining cursor idempotency via
 * githubIssueNumber uniqueness per project.
 */
export async function ingestWebhookIssue(projectId, action, ghIssue) {
    const db = getDb();
    const [existing] = await db
        .select()
        .from(schema.issues)
        .where(eq(schema.issues.githubIssueNumber, ghIssue.number))
        .limit(1);
    if (existing) {
        // Update existing local issue (don't overwrite status to avoid clobbering board position)
        const newStatus = ghIssue.state === 'closed'
            ? 'done'
            : existing.status;
        await db
            .update(schema.issues)
            .set({
            title: ghIssue.title,
            body: ghIssue.body ?? '',
            status: newStatus,
            updatedAt: new Date(),
        })
            .where(eq(schema.issues.id, existing.id));
    }
    else if (action === 'opened' || action === 'reopened') {
        // Create new issue sourced from GitHub
        await db.insert(schema.issues).values({
            projectId,
            title: ghIssue.title,
            body: ghIssue.body ?? '',
            status: 'backlog',
            githubIssueNumber: ghIssue.number,
            githubIssueUrl: ghIssue.html_url,
            githubNodeId: ghIssue.node_id,
        });
    }
}
// ─── Init ─────────────────────────────────────────────────────────────────────
let _initialized = false;
/**
 * Register all GitHub sync event bus listeners.
 * Called once from index.ts on startup.
 */
export function initGitHubSyncHooks() {
    if (_initialized)
        return;
    _initialized = true;
    eventBus.on('event', (event) => {
        const { type } = event;
        if (type === 'issue.created' || type === 'issue.updated' || type === 'issue.deleted') {
            handleIssueEvent(event).catch((err) => {
                console.error('[github-sync-hook] unhandled issue event error:', err);
            });
            return;
        }
        // Custom comment event (emitted as a generic BusEvent with type='comment.created')
        if (type === 'comment.created') {
            handleCommentEvent(event).catch((err) => {
                console.error('[github-sync-hook] unhandled comment event error:', err);
            });
        }
    });
    console.log('[github-sync-hook] listeners registered');
}
//# sourceMappingURL=sync-hook.js.map
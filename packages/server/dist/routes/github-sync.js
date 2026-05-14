/**
 * routes/github-sync.ts — Demo 15: GitHub sync configuration + control endpoints.
 *
 * GET    /api/projects/:id/github         — sync config + status (token redacted)
 * PUT    /api/projects/:id/github         — enable / configure sync
 * DELETE /api/projects/:id/github         — disable sync, clear credentials
 * POST   /api/projects/:id/github/sync    — trigger full push of all issues
 * GET    /api/projects/:id/github/log     — last 50 sync log entries
 * POST   /api/projects/:id/github/webhook — ingest GitHub webhook events
 */
import { Router } from 'express';
import { getDb, getPool, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { GitHubSync, startSyncLoop, stopSyncLoop } from '../github/sync.js';
import { ingestWebhookIssue } from '../github/sync-hook.js';
const router = Router({ mergeParams: true });
// ─── Helpers ──────────────────────────────────────────────────────────────────
function redactToken(token) {
    if (!token || token.length < 4)
        return token;
    return `****${token.slice(-4)}`;
}
function handleError(res, err) {
    console.error('[github-sync] error:', err);
    res.status(500).json({ error: 'Internal server error' });
}
async function getProject(projectId) {
    const db = getDb();
    const [project] = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
    return project ?? null;
}
// ─── GET /api/projects/:id/github ────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const project = await getProject(req.params.id);
        if (!project) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        const authType = project.githubAuthType ?? 'pat';
        const base = {
            githubSyncEnabled: project.githubSyncEnabled ?? false,
            githubOwner: project.githubOwner ?? null,
            githubRepo: project.githubRepo ?? null,
            githubSyncLastAt: project.githubSyncLastAt ?? null,
            authType,
        };
        if (authType === 'app') {
            res.json({
                ...base,
                appId: project.githubAppId ?? null,
                installationId: project.githubAppInstallationId ?? null,
                // privateKey is never returned over the API
            });
        }
        else {
            res.json({
                ...base,
                githubToken: redactToken(project.githubToken ?? null),
            });
        }
    }
    catch (err) {
        handleError(res, err);
    }
});
// ─── PUT /api/projects/:id/github ────────────────────────────────────────────
router.put('/', async (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;
        const body = req.body;
        const authType = body.authType ?? 'pat';
        if (!body.owner || !body.repo) {
            res.status(400).json({ error: 'owner and repo are required' });
            return;
        }
        let updates;
        if (authType === 'app') {
            if (!body.appId || !body.installationId || !body.privateKey) {
                res
                    .status(400)
                    .json({ error: 'appId, installationId, and privateKey are required for App auth' });
                return;
            }
            updates = {
                githubSyncEnabled: true,
                githubAuthType: 'app',
                githubOwner: body.owner,
                githubRepo: body.repo,
                githubToken: null,
                githubAppId: body.appId,
                githubAppInstallationId: body.installationId,
                githubAppPrivateKey: body.privateKey,
                updatedAt: new Date(),
            };
        }
        else {
            // PAT (default)
            if (!body.token) {
                res.status(400).json({ error: 'token is required for PAT auth' });
                return;
            }
            updates = {
                githubSyncEnabled: true,
                githubAuthType: 'pat',
                githubOwner: body.owner,
                githubRepo: body.repo,
                githubToken: body.token,
                githubAppId: null,
                githubAppInstallationId: null,
                githubAppPrivateKey: null,
                updatedAt: new Date(),
            };
        }
        const project = await getProject(id);
        if (!project) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        await db
            .update(schema.projects)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .set(updates)
            .where(eq(schema.projects.id, id));
        // (Re)start the sync loop for this project
        startSyncLoop(id);
        if (authType === 'app') {
            res.json({
                githubSyncEnabled: true,
                authType: 'app',
                githubOwner: body.owner,
                githubRepo: body.repo,
                appId: body.appId,
                installationId: body.installationId,
                // privateKey omitted
            });
        }
        else {
            res.json({
                githubSyncEnabled: true,
                authType: 'pat',
                githubOwner: body.owner,
                githubRepo: body.repo,
                githubToken: redactToken(body.token),
            });
        }
    }
    catch (err) {
        handleError(res, err);
    }
});
// ─── DELETE /api/projects/:id/github ─────────────────────────────────────────
router.delete('/', async (req, res) => {
    try {
        const db = getDb();
        const { id } = req.params;
        const project = await getProject(id);
        if (!project) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        await db
            .update(schema.projects)
            .set({
            githubSyncEnabled: false,
            githubToken: null,
            githubOwner: null,
            githubRepo: null,
            updatedAt: new Date(),
        })
            .where(eq(schema.projects.id, id));
        stopSyncLoop(id);
        res.json({ githubSyncEnabled: false });
    }
    catch (err) {
        handleError(res, err);
    }
});
// ─── POST /api/projects/:id/github/sync ──────────────────────────────────────
router.post('/sync', async (req, res) => {
    try {
        const { id } = req.params;
        const project = await getProject(id);
        if (!project) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        const authType = project.githubAuthType ?? 'pat';
        const missingConfig = !project.githubSyncEnabled ||
            !project.githubOwner ||
            !project.githubRepo ||
            (authType === 'pat' && !project.githubToken) ||
            (authType === 'app' &&
                (!project.githubAppId || !project.githubAppInstallationId || !project.githubAppPrivateKey));
        if (missingConfig) {
            res.status(409).json({ error: 'GitHub sync is not configured for this project' });
            return;
        }
        const sync = await GitHubSync.fromProject(id, project);
        const result = await sync.pushAllIssues();
        res.json({ ok: true, ...result });
    }
    catch (err) {
        handleError(res, err);
    }
});
// ─── GET /api/projects/:id/github/log ────────────────────────────────────────
router.get('/log', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = getPool();
        const { rows } = await pool.query(`SELECT id, project_id, direction, entity_type, entity_id,
              github_number, status, error_msg, synced_at
         FROM github_sync_log
        WHERE project_id = $1
        ORDER BY synced_at DESC
        LIMIT 50`, [id]);
        res.json(rows);
    }
    catch (err) {
        handleError(res, err);
    }
});
// ─── POST /api/projects/:id/github/webhook ───────────────────────────────────
//
// Ingest GitHub webhook events (issues event type).
// GitHub sends a JSON body with `action` and `issue` fields.
// In production you'd verify the X-Hub-Signature-256 header.
router.post('/webhook', async (req, res) => {
    try {
        const { id } = req.params;
        const project = await getProject(id);
        if (!project) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        const ghEvent = req.headers['x-github-event'];
        // Only handle "issues" events for now
        if (ghEvent !== 'issues') {
            res.json({ ok: true, ignored: true, event: ghEvent });
            return;
        }
        const { action, issue: ghIssue } = req.body;
        await ingestWebhookIssue(id, action, ghIssue);
        res.json({ ok: true, action, number: ghIssue.number });
    }
    catch (err) {
        handleError(res, err);
    }
});
export default router;
//# sourceMappingURL=github-sync.js.map
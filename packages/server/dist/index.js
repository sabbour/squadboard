import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startPglite, getPglite } from './db/pglite.js';
import { initDb, closeDb, getPool } from './db/index.js';
import healthRouter from './routes/health.js';
import projectsRouter from './routes/projects.js';
import squadRouter from './routes/squad.js';
import agentsRouter from './routes/agents.js';
import issuesRouter from './routes/issues.js';
import commentsMentionRouter from './routes/comments-mention.js';
import projectDeliverablesRouter, { issueDeliverablesRouter } from './routes/deliverables.js';
import labelsRouter from './routes/labels.js';
import columnMetaRouter from './routes/column-meta.js';
import { issueRunsRouter, projectRunsRouter } from './routes/runs.js';
import routingRouter from './routes/routing.js';
import { workflowsRouter, issueWorkflowRouter, workflowRunsRouter, stepRunsRouter, workflowTemplatesRouter } from './routes/workflows.js';
import { ceremoniesRouter, ceremoniesTopRouter } from './routes/ceremonies.js';
import costsRouter from './routes/costs.js';
import analyticsRouter from './routes/analytics.js';
import githubSyncRouter from './routes/github-sync.js';
import { modelsRouter } from './routes/models.js';
import { projectSessionsRouter } from './routes/sessions.js';
import { startersRouter } from './routes/starters.js';
import rolesRouter from './routes/roles.js';
import castingRouter from './routes/casting.js';
import castRouter from './routes/cast.js';
import reviewPoliciesRouter from './routes/review-policies.js';
import inboxRouter from './routes/inbox.js';
import { consultRouter, projectConsultRouter } from './routes/consult.js';
import { projectFlowRouter, issueFlowRouter } from './routes/flow.js';
import activityRouter from './routes/activity.js';
import { curatedSkillsRouter, projectSkillsRouter, agentSkillsRouter } from './routes/skills.js';
import { projectToolsRouter, agentToolsRouter } from './routes/tools.js';
import { projectMcpRouter, agentMcpRouter } from './routes/mcp.js';
import { diagnosticsRouter, projectDiagnosticsRouter } from './routes/diagnostics.js';
import heartbeatRouter from './routes/heartbeat.js';
import systemRouter from './routes/system.js';
// Wave 10 B3: side-effect import — subscribes the in-memory ring buffer to
// `eventBus.onHeartbeat` BEFORE heartbeat.start() schedules sweeps so the
// first sweep tick is already captured.
import './services/heartbeat.js';
import { createMcpHttpRouter } from './mcp/http-transport.js';
import { setDefaultProjectId } from './mcp/server.js';
import { heartbeat } from './engine/heartbeat.js';
import { stuckIssueRunsSweep } from './engine/sweeps/stuck-issue-runs.js';
import { idleLiveSessionsSweep } from './engine/sweeps/idle-live-sessions.js';
import { stalePresenceSweep } from './engine/sweeps/stale-presence.js';
import { readyWorkflowStepsSweep } from './engine/sweeps/ready-workflow-steps.js';
import { githubSyncOverdueSweep } from './engine/sweeps/github-sync-overdue.js';
import { ceremoniesDueSweep } from './engine/sweeps/ceremonies-due.js';
// Phase 10: side-effect import — registers the on_event ceremony listener
// against the in-process event bus.
import './services/ceremony-dispatcher.js';
import { initWebSocketServer } from './realtime/ws-server.js';
import { listPresence } from './realtime/presence.js';
import { initGitHubSyncHooks } from './github/sync-hook.js';
import { stopAllSyncLoops } from './github/sync.js';
// Phase 19: Templates & Portability
import templatesRouter from './routes/templates.js';
import teamPortabilityRouter from './routes/team-portability.js';
import projectPortabilityRouter from './routes/project-portability.js';
// Conjure smart-create — Phase 1 classify endpoint
import conjureRouter from './routes/conjure.js';
// Wave 10 Stream A1: auto-register the running squadboard repo as a project
import { registerSelfAtBoot } from './services/self-register.js';
// Q6=B: standalone coordinator daemon — auto-start when guards allow
import { maybeAutoStartDaemon } from './daemon/auto-start.js';
// Wave 20 — Stream G Phase 3: @copilot routes + watcher
import { copilotRouter } from './routes/copilot.js';
import { startCopilotWatcher, stopCopilotWatcher } from './services/copilot-watcher.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = parseInt(process.env.PORT ?? '3000', 10);
// packages/server/dist/index.js → up 2 → packages/ → client/dist
const CLIENT_DIST = join(__dirname, '..', '..', 'client', 'dist');
async function main() {
    const startMs = Date.now();
    console.log('[squadboard] starting…');
    // ── Wave 14: one-time legacy-PG → PGlite migration ─────────────────────
    // Runs BEFORE startPglite() so the migrator controls the PGlite boot.
    // Gated by:
    //   - DATABASE_URL set            → skip (hosted mode)
    //   - SQUADBOARD_AUTO_MIGRATE=false → skip (opt-out)
    //   - marker file present         → skip (already done)
    //   - legacy cluster absent       → skip (fresh install)
    if (process.env['SQUADBOARD_AUTO_MIGRATE'] !== 'false' && !process.env['DATABASE_URL']) {
        try {
            const { runMigration } = await import('./scripts/migrate-from-legacy-pg.js');
            const result = await runMigration({ force: false, dryRun: false, yes: false });
            if (result.skipped && result.reason && !result.reason.includes('No legacy cluster')) {
                console.log(`[migrate] ${result.reason}`);
            }
            else if (!result.skipped && result.snapshotPath) {
                // Migration created a dumpDataDir snapshot — restore from it immediately
                // so the data survives the upcoming startPglite() open (W21 regression fix).
                console.log('[migrate] Restoring migration snapshot into PGlite data dir…');
                const { runRestore } = await import('./scripts/restore.js');
                const restoreResult = await runRestore(result.snapshotPath, { force: true });
                if (restoreResult.ok) {
                    console.log('[migrate] ✅ Migration snapshot restored successfully.');
                }
                else {
                    console.error('[migrate] ⚠️  Snapshot restore failed:', restoreResult.message);
                }
            }
        }
        catch (err) {
            // Migration failure must not crash the server — log and continue.
            // Users can run `squadboard migrate` manually to retry.
            console.error('[migrate] ⚠️  Auto-migration failed (server will continue without legacy data):', err);
        }
    }
    const connectionString = await startPglite();
    await initDb(connectionString);
    // Wave 21 — i3: restart-pickup — mark any runs left in status='running'
    // as 'failed' with stale_reason='restart-pickup'. These are orphaned from
    // a prior unclean shutdown; no process is executing them any longer.
    try {
        const pool = getPool();
        const { rows: staleRuns } = await pool.query(`UPDATE issue_runs
          SET status       = 'failed',
              stale_reason = 'restart-pickup',
              error_message = COALESCE(error_message, '') || ' [recovered: server restarted]',
              updated_at   = NOW()
        WHERE status = 'running'
        RETURNING id`);
        if (staleRuns.length > 0) {
            console.log(`[squadboard] restart-pickup: recovered ${staleRuns.length} stale run(s): ${staleRuns.map(r => r.id).join(', ')}`);
        }
    }
    catch (err) {
        // Non-fatal — log and continue. Stale runs will be picked up by the
        // stuckIssueRunsSweep heartbeat on the next 30 s tick.
        console.warn('[squadboard] restart-pickup: stale run recovery failed (non-fatal):', err);
    }
    // Wave 10 Stream A1: dogfood — self-register the running squadboard repo as
    // a project on first boot so the MCP capture loop has somewhere to land
    // cards. Gated and idempotent (see services/self-register.ts).
    await registerSelfAtBoot();
    // Wave 10 / A3: honour SQUADBOARD_DEFAULT_PROJECT_ID for the HTTP MCP
    // transport too. The stdio entry point does this independently for desktop
    // clients; doing it here covers HTTP clients (e.g. VS Code) that hit /mcp.
    const mcpDefaultProjectId = process.env.SQUADBOARD_DEFAULT_PROJECT_ID;
    if (mcpDefaultProjectId && mcpDefaultProjectId.trim()) {
        setDefaultProjectId(mcpDefaultProjectId);
        console.log(`[squadboard] MCP default projectId from SQUADBOARD_DEFAULT_PROJECT_ID = ${mcpDefaultProjectId.trim()}`);
    }
    // Phase 3: register and start the heartbeat sweep registry
    // (replaces the old dispatcher.start() 5 s monolithic tick).
    heartbeat.register(stuckIssueRunsSweep); // 30 s — reclaim expired/orphaned runs
    heartbeat.register(idleLiveSessionsSweep); // 60 s — mark inactive sessions idle
    heartbeat.register(stalePresenceSweep); // 30 s — evict phantom presence records
    heartbeat.register(readyWorkflowStepsSweep); //  5 s — advance workflow steps + stepper
    heartbeat.register(githubSyncOverdueSweep); // 60 s — catch-up GitHub pulls
    heartbeat.register(ceremoniesDueSweep); //  5 s — fire due ceremony schedules
    heartbeat.start();
    // Demo 15: register GitHub sync event-bus hooks
    initGitHubSyncHooks();
    // Q6=B: auto-start coordinator daemon if no live daemon exists and guards allow.
    // Non-blocking — forks a detached child; server startup continues immediately.
    maybeAutoStartDaemon();
    const app = express();
    app.use(express.json());
    app.use('/api/health', healthRouter);
    app.use('/api/system', systemRouter);
    app.use('/api/activity', activityRouter);
    app.use('/api/inbox', inboxRouter);
    app.use('/api/consult', consultRouter);
    app.use('/api/projects', projectsRouter);
    app.use('/api/squad', squadRouter);
    app.use('/api/projects/:projectId/agents', agentsRouter);
    app.use('/api/projects/:projectId/sessions', projectSessionsRouter);
    app.use('/api/projects/:projectId/consult', projectConsultRouter);
    app.use('/api/projects/:projectId/issues', issuesRouter);
    app.use('/api/projects/:projectId/issues', commentsMentionRouter);
    app.use('/api/projects/:projectId/issues', issueDeliverablesRouter);
    app.use('/api/projects/:projectId/deliverables', projectDeliverablesRouter);
    app.use('/api/projects/:projectId/labels', labelsRouter);
    app.use('/api/projects/:projectId/columns', columnMetaRouter);
    app.use('/api/projects/:projectId/issues/:issueId/runs', issueRunsRouter);
    app.use('/api/projects/:projectId/runs', projectRunsRouter);
    // Phase 12: flow visualisation aggregators
    app.use('/api/projects/:projectId/flow', projectFlowRouter);
    app.use('/api/projects/:projectId/issues/:issueId/flow', issueFlowRouter);
    // Phase 13: skills registry — curated library, project CRUD, per-agent assignment.
    // Agent-scoped routes mount before project-scoped to avoid the catch-all conflict.
    app.use('/api/skills/curated', curatedSkillsRouter);
    app.use('/api/projects/:projectId/agents/:agentId/skills', agentSkillsRouter);
    app.use('/api/projects/:projectId/skills', projectSkillsRouter);
    // Phase 13: tools registry — project CRUD + per-agent assignment.
    app.use('/api/projects/:projectId/agents/:agentId/tools', agentToolsRouter);
    app.use('/api/projects/:projectId/tools', projectToolsRouter);
    // Phase 13: MCP servers — encrypted-headers registry + per-agent assignment.
    app.use('/api/projects/:projectId/agents/:agentId/mcp-servers', agentMcpRouter);
    app.use('/api/projects/:projectId/mcp-servers', projectMcpRouter);
    app.use('/api/projects/:projectId/routing', routingRouter);
    app.use('/api/models', modelsRouter);
    app.use('/api/roles', rolesRouter);
    app.use('/api/casting', castingRouter);
    app.use('/api/projects/:projectId/cast', castRouter);
    app.use('/api/projects/:projectId/review-policies', reviewPoliciesRouter);
    app.use('/api/starters', startersRouter);
    // Phase 10: ceremonies — primary surface (workflows = legacy alias).
    app.use('/api/projects/:projectId/ceremonies', ceremoniesRouter);
    app.use('/api/ceremonies', ceremoniesTopRouter);
    // Legacy workflows mounts: kept functional for now AND additionally issue
    // a 301 to the canonical /ceremonies/* URL via a forwarding middleware
    // mounted *first*. Express runs middleware in registration order, so the
    // redirect fires before the legacy router gets a chance to handle the
    // request. axios + fetch follow 301 transparently while preserving method.
    app.use('/api/projects/:projectId/workflows', (req, res, next) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
            res.redirect(301, req.originalUrl.replace('/workflows', '/ceremonies'));
            return;
        }
        next();
    });
    app.use('/api/projects/:projectId/workflows', workflowsRouter);
    app.use('/api/projects/:projectId/issues/:issueId/workflow', issueWorkflowRouter);
    app.use('/api/workflows/templates', (req, res, next) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
            res.redirect(301, req.originalUrl.replace('/api/workflows/templates', '/api/ceremonies/templates'));
            return;
        }
        next();
    });
    app.use('/api/workflows/templates', workflowTemplatesRouter);
    app.use('/api/projects/:id/costs', costsRouter);
    app.use('/api/projects/:id/analytics', analyticsRouter);
    // Demo 15: GitHub sync endpoints
    app.use('/api/projects/:id/github', githubSyncRouter);
    // Wave 20 — G4.1 + G4.3: @copilot assign + auto-assign label rules
    app.use('/api/projects', copilotRouter);
    // Phase 3 Doctor: diagnostics
    app.use('/api/diagnostics', diagnosticsRouter);
    app.use('/api/projects/:id/diagnostics', projectDiagnosticsRouter);
    // Phase 3 Heartbeat: sweep registry status + manual controls
    app.use('/api/heartbeat', heartbeatRouter);
    // Demo 9: peer review endpoints (not project-scoped)
    app.use('/api/workflow-runs', workflowRunsRouter);
    app.use('/api/step-runs', stepRunsRouter);
    // Conjure smart-create — POST /api/conjure/classify
    app.use('/api/conjure', conjureRouter);
    // Wave 10 B7 — team portability (export/import/save-as-template/instantiate)
    app.use('/api/projects/:id/team', teamPortabilityRouter);
    // Phase 19 — project portability (export/import/save-as-template/instantiate)
    app.use('/api/projects/:id', projectPortabilityRouter);
    // Phase 19 — templates CRUD
    app.use('/api/templates', templatesRouter);
    // Demo 12: presence REST endpoint (GET /api/projects/:id/presence)
    app.get('/api/projects/:id/presence', (req, res) => {
        const presence = listPresence(req.params.id);
        res.json(presence);
    });
    // Phase 18: Squadboard exposes itself as an MCP server over Streamable HTTP
    // for VS Code (Insiders) + any HTTP-capable MCP client. Mounted *before* the
    // SPA fallback so /mcp doesn't return index.html. Stdio path
    // (packages/server/src/mcp/index.ts) stays for Claude Desktop / Cursor.
    app.use('/mcp', createMcpHttpRouter());
    if (existsSync(CLIENT_DIST)) {
        app.use(express.static(CLIENT_DIST));
        // SPA fallback — let the React router handle unknown paths
        app.use((_req, res) => {
            res.sendFile(join(CLIENT_DIST, 'index.html'));
        });
    }
    else {
        app.get('/', (_req, res) => {
            res.json({
                message: 'Squadboard API',
                version: '0.1.0',
                endpoints: ['/api/health', '/api/projects'],
                note: 'Frontend not yet built — run Keyser\'s `pnpm build` in packages/client first',
            });
        });
    }
    // Demo 12: wrap Express app in a raw HTTP server so WS can share port 3000
    const httpServer = createServer(app);
    initWebSocketServer(httpServer);
    // Wave 20 — G4.2: start @copilot PR watcher (60 s poll).
    startCopilotWatcher();
    const server = httpServer.listen(PORT, () => {
        const elapsed = Date.now() - startMs;
        console.log(`[squadboard] ready in ${elapsed}ms → http://localhost:${PORT}`);
    });
    const gracefulShutdown = (signal) => {
        const shutdownStart = Date.now();
        console.log(`[squadboard] ${signal} received — starting graceful shutdown`);
        // Stop accepting new connections and sweeps immediately.
        heartbeat.stop();
        stopAllSyncLoops();
        stopCopilotWatcher();
        // Give in-flight requests up to 10 s to complete.
        const DRAIN_TIMEOUT_MS = 10_000;
        const drainTimer = setTimeout(() => {
            console.warn(`[squadboard] drain timeout (${DRAIN_TIMEOUT_MS}ms) exceeded — forcing exit`);
            process.exit(1);
        }, DRAIN_TIMEOUT_MS);
        // Allow process to exit even if drainTimer is still pending.
        drainTimer.unref();
        server.close(async () => {
            try {
                // Issue a PGlite CHECKPOINT before closing — ensures WAL is flushed
                // and data is recoverable on next boot.
                const pglite = getPglite();
                if (pglite) {
                    try {
                        await pglite.exec('CHECKPOINT');
                    }
                    catch (cpErr) {
                        console.warn('[squadboard] CHECKPOINT failed (non-fatal):', cpErr);
                    }
                }
                await closeDb();
                const elapsed = Date.now() - shutdownStart;
                console.log(`[squadboard] shutdown.graceful signal=${signal} duration=${elapsed}ms`);
                clearTimeout(drainTimer);
                process.exit(0);
            }
            catch (err) {
                const elapsed = Date.now() - shutdownStart;
                console.error(`[squadboard] shutdown.error signal=${signal} duration=${elapsed}ms`, err);
                process.exit(1);
            }
        });
    };
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}
main().catch((err) => {
    const msg = err instanceof Error
        ? `${err.message}\n${err.stack ?? ''}`
        : err === undefined
            ? 'rejected with undefined (likely an `await` that threw with no value — check recent error handlers)'
            : err === null
                ? 'rejected with null'
                : typeof err === 'object'
                    ? JSON.stringify(err, null, 2)
                    : String(err);
    console.error('[squadboard] fatal startup error:', msg);
    process.exit(1);
});
//# sourceMappingURL=index.js.map
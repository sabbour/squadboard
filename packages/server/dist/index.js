import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEmbeddedPostgres } from './db/postgres.js';
import { initDb, closeDb } from './db/index.js';
import healthRouter from './routes/health.js';
import projectsRouter from './routes/projects.js';
import squadRouter from './routes/squad.js';
import agentsRouter from './routes/agents.js';
import issuesRouter from './routes/issues.js';
import commentsMentionRouter from './routes/comments-mention.js';
import projectDeliverablesRouter, { issueDeliverablesRouter } from './routes/deliverables.js';
import labelsRouter from './routes/labels.js';
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
import { projectFlowRouter, issueFlowRouter } from './routes/flow.js';
import { curatedSkillsRouter, projectSkillsRouter, agentSkillsRouter } from './routes/skills.js';
import { dispatcher } from './engine/dispatcher.js';
// Phase 10: side-effect import — registers the on_event ceremony listener
// against the in-process event bus.
import './services/ceremony-dispatcher.js';
import { initWebSocketServer } from './realtime/ws-server.js';
import { listPresence } from './realtime/presence.js';
import { initGitHubSyncHooks } from './github/sync-hook.js';
import { stopAllSyncLoops } from './github/sync.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = parseInt(process.env.PORT ?? '3000', 10);
// packages/server/dist/index.js → up 2 → packages/ → client/dist
const CLIENT_DIST = join(__dirname, '..', '..', 'client', 'dist');
async function main() {
    const startMs = Date.now();
    console.log('[squadboard] starting…');
    const connectionString = await startEmbeddedPostgres();
    await initDb(connectionString);
    // Start the workflow engine dispatcher (5 s tick: sweep → wake → advance)
    dispatcher.start();
    // Demo 15: register GitHub sync event-bus hooks
    initGitHubSyncHooks();
    const app = express();
    app.use(express.json());
    app.use('/api/health', healthRouter);
    app.use('/api/inbox', inboxRouter);
    app.use('/api/projects', projectsRouter);
    app.use('/api/squad', squadRouter);
    app.use('/api/projects/:projectId/agents', agentsRouter);
    app.use('/api/projects/:projectId/sessions', projectSessionsRouter);
    app.use('/api/projects/:projectId/issues', issuesRouter);
    app.use('/api/projects/:projectId/issues', commentsMentionRouter);
    app.use('/api/projects/:projectId/issues', issueDeliverablesRouter);
    app.use('/api/projects/:projectId/deliverables', projectDeliverablesRouter);
    app.use('/api/projects/:projectId/labels', labelsRouter);
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
    // Demo 9: peer review endpoints (not project-scoped)
    app.use('/api/workflow-runs', workflowRunsRouter);
    app.use('/api/step-runs', stepRunsRouter);
    // Demo 12: presence REST endpoint (GET /api/projects/:id/presence)
    app.get('/api/projects/:id/presence', (req, res) => {
        const presence = listPresence(req.params.id);
        res.json(presence);
    });
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
    const server = httpServer.listen(PORT, () => {
        const elapsed = Date.now() - startMs;
        console.log(`[squadboard] ready in ${elapsed}ms → http://localhost:${PORT}`);
    });
    const gracefulShutdown = (signal) => {
        console.log(`[squadboard] received ${signal}`);
        dispatcher.stop();
        stopAllSyncLoops(); // Demo 15: stop GitHub sync polling loops
        server.close(() => {
            closeDb()
                .then(() => process.exit(0))
                .catch(() => process.exit(1));
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
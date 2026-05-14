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
import labelsRouter from './routes/labels.js';
import { issueRunsRouter, projectRunsRouter } from './routes/runs.js';
import routingRouter from './routes/routing.js';
import { workflowsRouter, issueWorkflowRouter, workflowRunsRouter, stepRunsRouter } from './routes/workflows.js';
import costsRouter from './routes/costs.js';
import analyticsRouter from './routes/analytics.js';
import githubSyncRouter from './routes/github-sync.js';
import { dispatcher } from './engine/dispatcher.js';
import { initWebSocketServer } from './realtime/ws-server.js';
import { listPresence } from './realtime/presence.js';
import { initGitHubSyncHooks } from './github/sync-hook.js';
import { stopAllSyncLoops } from './github/sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PORT ?? '3000', 10);

// packages/server/dist/index.js → up 2 → packages/ → client/dist
const CLIENT_DIST = join(__dirname, '..', '..', 'client', 'dist');

async function main(): Promise<void> {
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
  app.use('/api/projects', projectsRouter);
  app.use('/api/squad', squadRouter);
  app.use('/api/projects/:projectId/agents', agentsRouter);
  app.use('/api/projects/:projectId/issues', issuesRouter);
  app.use('/api/projects/:projectId/labels', labelsRouter);
  app.use('/api/projects/:projectId/issues/:issueId/runs', issueRunsRouter);
  app.use('/api/projects/:projectId/runs', projectRunsRouter);
  app.use('/api/projects/:projectId/routing', routingRouter);
  app.use('/api/projects/:projectId/workflows', workflowsRouter);
  app.use('/api/projects/:projectId/issues/:issueId/workflow', issueWorkflowRouter);
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
  } else {
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
    console.log(
      `[squadboard] ready in ${elapsed}ms → http://localhost:${PORT}`,
    );
  });

  const gracefulShutdown = (signal: string) => {
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

main().catch((err: unknown) => {
  console.error('[squadboard] fatal startup error:', err);
  process.exit(1);
});
